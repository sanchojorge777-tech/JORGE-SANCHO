// Renders a QR code as inline SVG using the bundled generator (vendor/qrcode.js).
export function qrSvg(text, margin = 2) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
    '" shape-rendering="crispEdges" role="img" aria-label="QR code to join the game">' +
    '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#0A101E"/></svg>';
}
