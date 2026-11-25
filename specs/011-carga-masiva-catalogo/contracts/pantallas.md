# Contrato de pantallas: carga masiva (011)

Panel del propietario (`/app/...`, rol `PROPIETARIO`). Diseño actual: tokens de `tokens.css`, claro y oscuro, 360 px
primero, axe sin errores, todo con teclado. Textos en español simple.

## Entradas

- **Servicios** (`/app/servicios`): botón secundario "Agregar varios" junto a "Nuevo servicio" → `/app/servicios/agregar-varios`.
- **Barberos** (`/app/barberos`): botón "Agregar varios" → `/app/barberos/agregar-varios`. Si no quedan cupos
  (`disponibles = 0`), el botón sigue visible y la pantalla explica el límite del plan con un enlace a "Mi suscripción".
- Con la suscripción vencida o suspendida, los botones no se muestran (como "Nuevo servicio" hoy).

## Pantalla "Agregar varios servicios"

1. Encabezado: título, una línea de ayuda ("Escribe o pega desde Excel o Google Sheets: nombre, duración en minutos,
   precio en soles") y el contador "N de 50 filas".
2. Acciones: "Agregar fila", "Agregar servicios típicos", "Pegar desde una hoja" (abre un área de texto accesible
   donde se pega; también funciona pegar directamente sobre la primera celda).
3. Filas: a 360 px, una ficha por fila con campos con etiqueta (Nombre, Duración (min), Precio (S/), Descripción
   opcional) y "Quitar fila"; desde 48rem, una tabla con encabezados de columna y un botón por fila.
4. "Revisar" llama a `POST /servicios/lote/revision`. Resultado:
   - Sin errores: aviso de éxito "Todo listo: se crearán N servicios" y "Guardar" habilitado.
   - Con errores: resumen arriba ("Hay 3 filas con errores") con enlaces que llevan el foco al primer campo con error;
     cada campo con error en rojo con su texto (`aria-invalid`, `aria-describedby`). "Guardar" deshabilitado.
   - Cualquier cambio en la tabla vuelve a pedir "Revisar" (la revisión vieja se descarta).

**Servicios típicos**: "Agregar servicios típicos" agrega 6 filas (Corte 30 min, Barba 20 min, Corte y barba 50 min,
Cejas 10 min, Corte para niños 30 min, Lavado 10 min) con el **precio vacío** y el foco en el precio de la primera fila
agregada. La ayuda dice "Escribe el precio de cada servicio; borra los que no ofreces". La aplicación nunca propone
precios. Si ya hay una fila con el mismo nombre, ese típico no se agrega de nuevo. Revisar sin precios marca cada fila
con "Falta el precio".
5. "Guardar" llama a `POST /servicios/lote` con una `Idempotency-Key` creada al revisar sin errores (la misma en los
   reintentos; nueva si cambian las filas). Éxito: "Se crearon N servicios" y vuelta a `/app/servicios` con la lista
   actualizada. Error: la tabla conserva lo escrito; `CARGA_INVALIDA` o `NOMBRE_DUPLICADO` vuelven a revisar y marcan
   las filas; un error de red ofrece "Intentar de nuevo" con la misma clave.
6. Salir con filas escritas pide confirmación ("Perderás lo que escribiste").

## Pantalla "Agregar varios barberos"

Igual que la de servicios, con:

- Columnas: Nombre y "Servicios que ofrece" (casillas con los servicios **activos**; a 360 px, un desplegable con
  casillas por fila). Atajo "Marcar todos los servicios" por fila.
- Cupo arriba: "Tu plan permite M barberos activos. Tienes A. Puedes agregar D." Si la carga supera D: error de carga
  con el texto "Quita X filas o cambia de plan".
- Advertencias (nombre repetido) en ámbar, con ícono y texto; no deshabilitan "Guardar".
- Sin servicios activos: se puede cargar igual (barberos sin servicios) con un aviso de que no aparecerán en las
  reservas hasta tener servicios.

## Textos de los problemas

| Problema            | Texto                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `longitud` (nombre) | "Escribe un nombre de 2 a 80 letras."                                                  |
| `rango`             | "La duración debe estar entre 5 y 480 minutos."                                       |
| `multiplo_de_5`     | "Usa minutos de 5 en 5 (por ejemplo 25, 30 o 45)."                                    |
| `falta` (precio)    | "Falta el precio: escríbelo en soles (por ejemplo 25 o 25.50)."                       |
| `formato` (precio)  | "Escribe el precio en soles, con hasta dos decimales (por ejemplo 25 o 25.50)."       |
| `longitud` (desc.)  | "La descripción puede tener hasta 300 letras."                                         |
| `repetido_en_carga` | Servicios: "Este nombre ya está en otra fila." Barberos (advertencia): "Otro barbero de la lista se llama igual; revisa que no sea el mismo." |
| `ya_existe`         | Servicios: "Ya tienes un servicio con este nombre (puede estar desactivado: reactívalo en Servicios)." Barberos (advertencia): "Ya hay un barbero llamado así; revisa que no sea el mismo." |
| `inactivo`          | "Uno de los servicios elegidos está desactivado."                                     |
| `supera_cupo`       | "Tu plan permite M barberos activos y ya tienes A. Quita X filas o cambia de plan."    |

## Pegado desde una hoja (`pegado-de-hoja.ts`, función pura)

- Filas por salto de línea (`\r\n` o `\n`), columnas por tabulación; celdas entre comillas de Excel (con tabulaciones o
  saltos dentro) se respetan.
- Se descarta la primera línea si parece encabezado (contiene "nombre" y no tiene números en duración/precio).
- Se quitan espacios de los extremos; las líneas vacías se ignoran.
- Precio: se quita "S/" y espacios, y la coma decimal pasa a punto ("25,50" → "25.50"). Duración: se toma el número
  inicial ("30 min" → 30). Lo que no se puede entender se deja tal cual para que la revisión lo marque.
- Barberos: solo la primera columna (nombre); el resto se ignora.
- Tope: si con lo pegado se pasa de 50 filas, se agregan las que caben y se avisa "Se agregaron K filas; N quedaron
  fuera por el límite de 50".
