// O wrangler importa ficheiros .html como texto (regra de módulos por omissão).
declare module "*.html" {
  const conteudo: string;
  export default conteudo;
}
