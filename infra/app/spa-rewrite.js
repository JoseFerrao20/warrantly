// CloudFront Function (viewer request): rotas do React (ex.: /compras/3) não são ficheiros
// no S3, por isso passam a /index.html. Ficheiros com extensão (ex.: /assets/x.js) passam
// tal como estão. Não toca em /api/* (essa rota vai para o Lambda).
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split("/").pop();
  if (lastSegment.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}
