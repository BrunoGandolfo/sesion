import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Sólo sirve el HTML local. No recibe ni almacena audio.
export async function serve(port = 4177) {
  const html = await readFile(new URL('./index.html', import.meta.url));
  const server = createServer((req, res) => {
    if (req.url === '/blank') {
      res.writeHead(200, {'Content-Type':'text/html'});
      res.end('<title>Otra pestaña</title><p>Pestaña de control de visibilidad</p>');
    } else if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(html);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4177);
  await serve(port);
  console.log(`Prueba local en http://127.0.0.1:${port}`);
}
