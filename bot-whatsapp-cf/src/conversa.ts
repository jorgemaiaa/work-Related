/**
 * Uma conversa = um Durable Object (um por número de telefone).
 *
 * - Guarda as mensagens e a ficha na sua própria base de dados SQLite.
 * - Usa o "alarm" para esperar alguns segundos por mais mensagens antes de responder.
 * - Processa um turno de cada vez e sincroniza com o Zoho no fim.
 */
import { DurableObject } from "cloudflare:workers";
import { anexosValidos, executarTurno } from "./agente";
import { BOAS_VINDAS, MENSAGEM_FALHA, MENSAGEM_POS_CONCLUSAO } from "./prompts";
import { estadoInicial, registar, type Env, type Estado, type LinhaMensagem, type MensagemRecebida } from "./tipos";
import { WhatsApp } from "./whatsapp";
import { ZohoCliente } from "./zoho";
import { montarDados } from "./zoho-mapa";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT UNIQUE,
  direcao TEXT NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT,
  media_id TEXT,
  media_chave TEXT,
  media_mime TEXT,
  processada INTEGER NOT NULL DEFAULT 0,
  anexo_categoria TEXT,
  anexo_utilizavel INTEGER,
  anexo_nota TEXT,
  zoho_anexo_enviado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
)`;

const EXTENSOES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};
const MAX_TENTATIVAS = 4; // a Cloudflare repete o alarm automaticamente quando ele falha
const INTERVALO_ZOHO_MS = 5 * 60_000;

export class Conversa extends DurableObject<Env> {
  private estado: Estado = estadoInicial();
  private aProcessar = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(ESQUEMA);
      this.estado = (await ctx.storage.get<Estado>("estado")) ?? estadoInicial();
    });
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private async guardarEstado(): Promise<void> {
    await this.ctx.storage.put("estado", this.estado);
  }

  // ---------------------------------------------------------------- entrada

  /** Chamado pelo Worker para cada mensagem do webhook. Devolve false se for repetida. */
  async receber(msg: MensagemRecebida, agendar = true): Promise<boolean> {
    if (!this.estado.telefone) this.estado.telefone = msg.telefone;
    if (msg.nome && !this.estado.nomePerfil) this.estado.nomePerfil = msg.nome;
    const r = this.sql.exec(
      `INSERT OR IGNORE INTO mensagens (wa_id, direcao, tipo, texto, media_id, media_chave, media_mime, criado_em)
       VALUES (?, 'in', ?, ?, ?, ?, ?, ?)`,
      msg.waId,
      msg.tipo,
      msg.texto,
      msg.mediaId,
      msg.mediaChave ?? null,
      msg.mime,
      new Date().toISOString(),
    );
    await this.guardarEstado();
    if (r.rowsWritten === 0) return false; // a Meta reenviou uma mensagem já recebida
    // Cada mensagem nova adia o alarm: só respondemos quando o cliente pára de escrever
    if (agendar) await this.ctx.storage.setAlarm(Date.now() + Number(this.env.DEBOUNCE_MS || 8000));
    return true;
  }

  async alarm(info?: AlarmInvocationInfo): Promise<void> {
    if (this.aProcessar) {
      await this.ctx.storage.setAlarm(Date.now() + 3000);
      return;
    }
    this.aProcessar = true;
    try {
      try {
        await this.processar();
      } catch (erro) {
        this.estado = (await this.ctx.storage.get<Estado>("estado")) ?? this.estado; // descarta alterações a meio
        const tentativa = info?.retryCount ?? 0;
        registar("erro_processar", { telefone: this.estado.telefone, tentativa, erro: String(erro) });
        if (tentativa < MAX_TENTATIVAS) throw erro; // a Cloudflare volta a chamar alarm()
        await this.desistir();
      }
      await this.sincronizarZoho();
    } finally {
      this.aProcessar = false;
    }
    if (this.estado.zohoPorSincronizar && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + INTERVALO_ZOHO_MS); // nova tentativa com o Zoho
    }
  }

  // ---------------------------------------------------------------- processamento

  private async processar(): Promise<void> {
    const novas = this.sql
      .exec<LinhaMensagem>("SELECT * FROM mensagens WHERE direcao = 'in' AND processada = 0 ORDER BY id")
      .toArray();
    if (!novas.length) return;

    const wa = new WhatsApp(this.env);
    for (const m of novas) {
      if ((m.tipo === "imagem" || m.tipo === "pdf") && m.media_id && !m.media_chave) {
        try {
          const { dados, mime } = await wa.descarregarMedia(m.media_id);
          const chave = `${this.estado.telefone}/${m.id}${EXTENSOES[mime.split(";")[0]] ?? ".bin"}`;
          await this.env.ANEXOS.put(chave, dados, { httpMetadata: { contentType: mime } });
          this.sql.exec("UPDATE mensagens SET media_chave = ?, media_mime = ? WHERE id = ?", chave, mime, m.id);
          m.media_chave = chave;
          m.media_mime = mime;
        } catch (erro) {
          registar("erro_media", { telefone: this.estado.telefone, mensagem: m.id, erro: String(erro) });
        }
      }
    }

    const ids = novas.map((m) => m.id);
    const marcarProcessadas = () =>
      this.sql.exec(`UPDATE mensagens SET processada = 1 WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);

    if (this.estado.estado !== "em_recolha") {
      // Conversa já entregue à equipa: o bot não volta a recolher dados
      marcarProcessadas();
      if (this.estado.estado === "concluida") await this.enviar(MENSAGEM_POS_CONCLUSAO, "texto", true);
      return;
    }

    if (!this.estado.boasVindasEnviadas) {
      await this.enviar(BOAS_VINDAS, "boas_vindas");
      this.estado.boasVindasEnviadas = true;
      await this.guardarEstado();
    }

    const resposta = await executarTurno({ env: this.env, estado: this.estado, sql: this.sql }, novas);
    marcarProcessadas();
    await this.guardarEstado();
    if (resposta) await this.enviar(resposta);
  }

  private async enviar(texto: string, tipo = "texto", semRepetir = false): Promise<void> {
    if (semRepetir) {
      const ultima = this.sql
        .exec<{ texto: string | null }>("SELECT texto FROM mensagens WHERE direcao = 'out' ORDER BY id DESC LIMIT 1")
        .toArray()[0];
      if (ultima?.texto === texto) return;
    }
    await new WhatsApp(this.env).enviarTexto(this.estado.telefone, texto);
    this.sql.exec(
      "INSERT INTO mensagens (direcao, tipo, texto, processada, criado_em) VALUES ('out', ?, ?, 1, ?)",
      tipo,
      texto,
      new Date().toISOString(),
    );
  }

  /** Depois de várias falhas seguidas: passa a conversa à equipa e avisa o cliente. */
  private async desistir(): Promise<void> {
    this.sql.exec("UPDATE mensagens SET processada = 1 WHERE direcao = 'in' AND processada = 0");
    this.estado.estado = "humano";
    this.estado.resumo = "Passagem automática para a equipa: falhas técnicas repetidas.";
    this.estado.zohoPorSincronizar = true;
    await this.guardarEstado();
    try {
      await this.enviar(MENSAGEM_FALHA);
    } catch (erro) {
      registar("erro_envio_falha", { telefone: this.estado.telefone, erro: String(erro) });
    }
  }

  // ---------------------------------------------------------------- Zoho

  /** Cria ou atualiza o contacto, o registo e os anexos. Erros ficam para nova tentativa. */
  private async sincronizarZoho(): Promise<void> {
    const e = this.estado;
    if (this.env.ZOHO_ENABLED !== "true" || !e.zohoPorSincronizar) return;
    const zoho = new ZohoCliente(this.env);
    try {
      if (!e.zohoContactoId) {
        e.zohoContactoId = (await zoho.procurarContacto(e.telefone)) ?? (await zoho.criarContacto(e.nomePerfil, e.telefone));
        await this.guardarEstado();
      }
      const dados = montarDados(e);
      if (!e.zohoRegistoId) {
        e.zohoRegistoId = await zoho.criarRegisto(dados);
        await this.guardarEstado();
      } else {
        await zoho.atualizarRegisto(e.zohoRegistoId, dados);
      }

      const anexos = this.sql
        .exec<LinhaMensagem>(
          "SELECT * FROM mensagens WHERE anexo_utilizavel = 1 AND zoho_anexo_enviado = 0 AND media_chave IS NOT NULL",
        )
        .toArray();
      for (const m of anexos) {
        const objeto = await this.env.ANEXOS.get(m.media_chave!);
        if (!objeto) continue;
        const extensao = m.media_chave!.slice(m.media_chave!.lastIndexOf("."));
        await zoho.anexar(
          e.zohoRegistoId,
          `${m.anexo_categoria}_${m.id}${extensao}`,
          await objeto.arrayBuffer(),
          m.media_mime ?? "application/octet-stream",
        );
        this.sql.exec("UPDATE mensagens SET zoho_anexo_enviado = 1 WHERE id = ?", m.id); // um a um, sem duplicar
      }

      e.zohoPorSincronizar = false;
      await this.guardarEstado();
      registar("zoho_sincronizado", { telefone: e.telefone, registo: e.zohoRegistoId });
    } catch (erro) {
      registar("erro_zoho", { telefone: e.telefone, erro: String(erro) });
      await this.guardarEstado(); // guarda os IDs já obtidos, para não criar duplicados
    }
  }

  // ---------------------------------------------------------------- só para o simulador (MODO_DEV)

  /** Processa já, sem esperar pelo alarm, e devolve as respostas do bot. */
  async processarAgora(): Promise<string[]> {
    if (this.aProcessar) return ["[ainda a processar a mensagem anterior]"];
    const ultimoId = this.sql.exec<{ m: number | null }>("SELECT MAX(id) AS m FROM mensagens").one().m ?? 0;
    this.aProcessar = true;
    try {
      await this.processar();
      await this.sincronizarZoho();
    } catch (erro) {
      this.estado = (await this.ctx.storage.get<Estado>("estado")) ?? this.estado;
      throw erro;
    } finally {
      this.aProcessar = false;
    }
    return this.sql
      .exec<{ texto: string | null }>("SELECT texto FROM mensagens WHERE direcao = 'out' AND id > ? ORDER BY id", ultimoId)
      .toArray()
      .map((l) => l.texto ?? "");
  }

  async verFicha(): Promise<Record<string, unknown>> {
    const anexos = this.sql
      .exec("SELECT id, anexo_categoria, anexo_utilizavel, anexo_nota FROM mensagens WHERE anexo_categoria IS NOT NULL")
      .toArray();
    return { ...this.estado, anexos, anexosValidos: [...anexosValidos(this.sql)] };
  }

  async apagar(): Promise<void> {
    if (this.estado.telefone) {
      const lista = await this.env.ANEXOS.list({ prefix: `${this.estado.telefone}/` });
      if (lista.objects.length) await this.env.ANEXOS.delete(lista.objects.map((o) => o.key));
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.sql.exec(ESQUEMA);
    this.estado = estadoInicial();
  }
}
