// CloudFront Function (viewer request) em /api/*: escreve em X-Viewer-IP o IP que o CloudFront
// viu, por cima de qualquer valor que o cliente tenha enviado. A API só o aceita com o segredo
// X-Origin-Verify, que o CloudFront junta a seguir (backend/app/origin.py). O X-Forwarded-For
// não serve para isto: quem faz o pedido pode escrever lá o que quiser.
function handler(event) {
  var request = event.request;
  request.headers["x-viewer-ip"] = { value: event.viewer.ip };
  return request;
}
