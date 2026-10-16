# Imágenes públicas

Fotos que la aplicación sirve tal cual (por ejemplo, la del panel de marca de Registro, Ingresar y Activar).
Mientras no haya foto, el panel usa la ilustración propia `IlustracionBarberia` (SVG en el código).

## Cómo usar una foto real en el panel de marca

1. Guarda la foto aquí, por ejemplo `public/img/barberia.webp`.
2. En `src/components/MarcoAcceso.tsx` cambia `FOTO_MARCA` a `'/img/barberia.webp'`.
3. Si el motivo principal no queda centrado, ajusta el encuadre con la propiedad `encuadre` de
   `ImagenMarca` (por ejemplo `'30% center'`).

`ImagenMarca` pone una capa oscura encima de la foto para que el texto del panel mantenga el contraste
(WCAG AA). Revisa el resultado en tema claro y oscuro: el panel es siempre oscuro.

## Requisitos de cada imagen

| Requisito | Valor                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Formato   | **WebP** (calidad 75–80). JPEG solo como respaldo si hiciera falta.                             |
| Peso      | **200 KB como máximo** por imagen.                                                              |
| Tamaño    | 1600 × 2000 px como máximo para el panel (vertical, ocupa media pantalla en escritorio).        |
| Licencia  | Propia, cedida por escrito o con licencia que permita uso comercial sin atribución obligatoria. |
| Autoría   | Anotar autor, fuente y licencia en la tabla de abajo, en el mismo cambio que agrega la foto.    |
| Personas  | Si aparece alguien reconocible, contar con su autorización por escrito.                         |

Para convertir y comprimir sin instalar nada global, se puede usar [Squoosh](https://squoosh.app) en el
navegador.

## Registro de imágenes

| Archivo | Autor | Fuente | Licencia | Fecha |
| ------- | ----- | ------ | -------- | ----- |
| —       | —     | —      | —        | —     |
