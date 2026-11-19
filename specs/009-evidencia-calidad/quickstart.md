# Quickstart de validación: 009

Guía para comprobar cada historia por separado. Los comandos están en
[contracts/comandos.md](contracts/comandos.md), y la forma de la evidencia en [data-model.md](data-model.md). Todo se
ejecuta desde `tecnologia/plataforma-barberias/`, con Docker Desktop y sin leer ni mostrar el `.env` del responsable.

## Requisitos previos

- Docker con Compose v2. Node 22 es opcional: si falta, los scripts usan la imagen `node:22`.
- **La demo de desarrollo y la demo publicada se levantan de una en una, nunca a la vez.** En un equipo de 8 GB, cada
  una ya usa unos 1,9 GB solo de contenedores (006 R12), y además comparten puertos y subred. Antes de pasar de una a
  otra, detener la que está corriendo con `docker compose stop` (en la publicada, con `-p barberias-publicacion`).
  `docker compose down -v` no se usa nunca para esto.
- Para la validación de US3 por un tercero: una **copia limpia** del repositorio en otra carpeta, sin `.env`.
- Para US7 y US8 (tareas del responsable): el túnel creado, las credenciales en `publicacion/secretos/`,
  `publicacion/publicacion.env` completo y los registros DNS proxied en Cloudflare. El agente no lee ninguno de esos
  archivos, ni `cuentas-publicadas.json`.

## US3 · Arranque reproducible

1. En la copia limpia, ejecutar `./scripts/preparar-entorno.sh`. Se espera que cree `.env` y que la salida diga
   "generada" por cada clave, sin ningún valor.
2. Ejecutarlo otra vez. Se espera que no toque el archivo (mismo hash) y que diga "no falta ninguna variable".
3. En PowerShell, en otra copia limpia, ejecutar `.\scripts\preparar-entorno.ps1` y comprobar lo mismo.
4. Ejecutar `docker compose up -d` y luego `docker compose --profile herramientas run --rm semilla`. Se espera
   "creadas" la primera vez y "0 creadas" la segunda.
5. Abrir `http://localhost:5173/b/barberia-demo-centro` y `/b/barberia-demo-huamanga`. Entrar con las cuentas de
   la demo **local** de `semilla/README.md` (contraseñas de desarrollo, solo para este equipo). El propietario de una
   barbería no ve nada de la otra.
5b. Pasar `--reiniciar-contrasenas` a la semilla en el modo local. Se espera el código 3 ("rechazado en el modo
   local") sin ningún cambio.
6. **SC-001:** tomar el tiempo de los pasos 1 a 5 (sin contar descargas). Es una tarea del responsable, con
   cronómetro.

## US1 · Carga con k6

1. Con la demo y la semilla levantadas, ejecutar `./carga/medir.sh horarios`, luego `catalogo` y luego `reserva`.
2. Se espera una carpeta por escenario en `evidencia/carga/`, con `crudo.json`, `entorno.json` y `resumen.md`. El
   resumen dice "cumple" o "no cumple" por umbral, el reparto entre `backend-1` y `backend-2` y el límite de
   solicitudes usado.
3. Comprobar que el límite volvió a su valor después de la medición:
   `docker compose exec backend-1 printenv PUBLICO_LIMITE_POR_MINUTO`.
4. Las citas de la prueba están solo en barberías `carga-*`.

## US2 · Extremo a extremo, accesibilidad y rendimiento

1. Ejecutar `docker compose --profile e2e run --rm e2e npx playwright test`. Se espera que pasen 5 de 5 recorridos.
2. Ejecutar `./e2e/estabilidad.sh 5`. Se esperan 5 carpetas y `evaluacion.md`.
3. En GitHub, lanzar 3 veces a mano el trabajo `e2e`, guardar los enlaces y completar la evaluación (tarea del
   responsable).
4. Ejecutar `npm run calidad-web` en el contenedor `e2e`. Se esperan 8 informes de axe y 8 de Lighthouse, y
   `entorno.json` dice contra qué se midió (8080 o `vite preview`).

## US4 · Interfaz de producción y PR03

1. Ejecutar `docker compose --profile produccion up -d preparar-frontend nginx`.
2. `curl -sI http://localhost:8080/` debe dar `Cache-Control: no-cache`. `curl -sI` a un archivo de
   `/assets/<…>.js` debe dar `max-age=31536000, immutable`. `curl -s http://localhost:8080/app/agenda` debe devolver
   el `index.html`.
3. `http://localhost:5173` sigue funcionando con recarga en caliente.
4. Ejecutar `./carga/escalado/agregar-instancia.sh`. Se espera el throughput con 2 y con 3 instancias y las
   solicitudes perdidas durante el alta, en `evidencia/carga/*-escalado-pr03/`.

## US5 · Base de datos

1. Ejecutar `docker compose -f docker-compose.yml -f docker-compose.medicion.yml up -d db`, después un escenario
   corto de k6 y después `./evidencia/scripts/extraer-planes.sh`. Se espera un plan por consulta crítica con el
   índice usado.
2. Ejecutar `node semilla/volumen.mjs --citas 520000` y volver a medir horarios y reportes.
3. Ejecutar `./evidencia/scripts/simulacro-respaldo.sh`. Se espera un acta con los tiempos, los conteos iguales y RLS
   activa. La base `barberias_restaurada` ya no existe al terminar.
4. Volver a levantar `db` sin el archivo de medición, para quitar `auto_explain`.

## US6 · Calidad medible

1. Ejecutar `npm run test:cobertura` en el backend y en el frontend. Se espera `evidencia/cobertura/` con los
   porcentajes y las exclusiones.
2. Ejecutar 3 veces seguidas la suite completa. Se espera que las 11 pruebas frágiles pasen, y la mediana de las
   metas queda guardada con `MEDIR_METAS=1`.
3. El README muestra la insignia de la CI.

## US7 · Dominio, CDN y CD

1. Con la demo local detenida, ejecutar `./publicacion/levantar.sh`, que usa el proyecto `barberias-publicacion`.
   Después, ejecutar la semilla con `--modo publicacion` (tarea del responsable). Se espera
   `publicacion/secretos/cuentas-publicadas.json` creado, ninguna contraseña en la salida, y que
   `git check-ignore publicacion/secretos/cuentas-publicadas.json` lo marque como ignorado.
2. Abrir `https://ayacuchobarber.shop`. Se espera HTTPS válido, las barberías de ejemplo y el inicio de sesión con
   una cuenta de ese archivo. Las contraseñas de la demo local **no** funcionan en la publicada.
2b. Ejecutar `./semilla/reiniciar-publicacion.sh`. Se espera que las contraseñas anteriores dejen de funcionar, que
   las nuevas del archivo funcionen, y que el volumen de la demo local siga intacto (sus contraseñas de desarrollo
   siguen sirviendo).
3. Ejecutar `./evidencia/scripts/evidencia-despliegue.sh`. Se espera `cf-cache-status: HIT` en el segundo pedido de
   un archivo de `assets`.
4. Hacer un cambio en `main` con la CI en verde. En menos de unos 6 minutos desde el fin de la CI,
   `https://ayacuchobarber.shop/version.json` muestra el SHA nuevo, y queda una línea en `publicaciones.jsonl`.
5. Con una CI en rojo no aparece ningún artefacto y la versión publicada no cambia.
6. Detener el túnel. La demo deja de responder, como dice el README.

## US8 · Subdominio por barbería

1. Ejecutar `npm run test:int -- nginx-publicacion` (prueba de sesión cruzada, de los reservados y de la
   redirección) y `npm run test:arch` (que el host no se lea en `backend/src`).
2. Abrir `https://barberia-demo-centro.ayacuchobarber.shop`. Se espera la redirección a `/b/barberia-demo-centro`
   con la página pública. `https://api.ayacuchobarber.shop` redirige al dominio raíz.
3. Comprobar que `/b/barberia-demo-centro` en el dominio raíz responde igual que antes.
