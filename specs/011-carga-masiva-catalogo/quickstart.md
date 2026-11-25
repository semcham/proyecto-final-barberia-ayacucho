# Quickstart: validar la carga masiva (011)

Sin leer ni tocar el `.env`. Docker solo en la copia `barberias-verificacion` o con Testcontainers. Proveedor de IA
falso y Mailpit (esta funcionalidad no usa ninguno de los dos).

## 1. Pruebas automáticas

```bash
cd tecnologia/plataforma-barberias/backend
npm run lint && npx tsc --noEmit
npm test -- test/unit/catalogo                          # dominio: problemas por campo, LimiteBarberos con "nuevos", ambos caminos iguales
npm run test:int -- test/integration/catalogo/carga-lote        # todo o nada, cupo, nombres, idempotencia, suscripción, permisos, auditoría
npm run test:int -- test/integration/catalogo/carga-lote-concurrencia   # dos cargas a la vez × 50 repeticiones
npm run test:int -- test/integration/aislamiento                # PR09 con las rutas nuevas
npm run test:arch                                       # PR14: sin dependencias nuevas entre módulos

cd ../frontend
npm run lint && npx tsc -b --noEmit && npx vitest run
```

Esperado: todo en verde; las pruebas actuales de `servicios.spec.ts` y `barberos.spec.ts` siguen pasando sin cambios.

**Medición SC-004 (2026-11-25, T046):** 50 servicios válidos guardados en **569 ms** (una corrida, Testcontainers en el equipo
de desarrollo; meta: menos de 3 s). La prueba `(SC-004)` de `carga-lote-servicios.spec.ts` imprime el valor en cada corrida.

## 2. Escenarios a mano (Compose de verificación con la semilla)

1. **Servicios pegados (US1)**: como propietario de la barbería de ejemplo, Servicios → "Agregar varios". Copiar de una
   hoja de cálculo 10 filas (nombre, duración, precio), con una fila con precio "25,50" y otra con "S/ 30". Pegar →
   aparecen 10 filas con los precios normalizados. "Revisar" → sin errores. "Guardar" → "Se crearon 10 servicios" y
   aparecen en la lista y en `/b/<slug>`.
2. **Típicos sin precio**: "Agregar servicios típicos" → 6 filas con nombre y duración, y el precio vacío. "Revisar" sin
   escribir precios → las 6 filas marcadas con "Falta el precio" y "Guardar" deshabilitado. Escribir los precios →
   "Revisar" sin errores → guarda.
3. **Errores por fila**: agregar los típicos con sus precios, poner duración 7 en una, dejar un nombre vacío y repetir "Corte" →
   "Revisar" marca 3 filas y "Guardar" queda deshabilitado. Corregir → guarda.
4. **Todo o nada**: con la revisión hecha, crear en otra pestaña un servicio con el nombre de una fila; volver y
   "Guardar" → no se crea ninguno, la fila queda marcada como "ya existe".
5. **Barberos y cupo (US2)**: en una barbería de plan Básico con un cupo libre de 2, cargar 3 barberos → la revisión dice
   "Quita 1 fila o cambia de plan". Quitar una → guarda 2, activos y sin usuario vinculado.
6. **Advertencia de nombre**: cargar un barbero con el nombre de uno existente → advertencia en ámbar; se puede guardar.
7. **Reintento**: con las herramientas del navegador sin red, pulsar "Guardar", volver a conectar e "Intentar de nuevo" →
   un solo grupo creado.
8. **Suscripción vencida**: los botones "Agregar varios" no aparecen; una llamada directa responde 403
   `SUSCRIPCION_NO_PERMITE` y no crea nada.
9. **Permisos y aislamiento**: con sesión de barbero, la ruta del panel no se ofrece y la API responde 403; con la sesión
   de la barbería A no se ve ni se usa ningún nombre de la barbería B.
10. **Auditoría**: `SERVICIOS_CARGADOS_EN_LOTE` y `BARBEROS_CARGADOS_EN_LOTE` aparecen en la auditoría de la barbería con
   la cantidad creada.

## 3. Interfaz

Capturas sobre el build de producción (no Vite) a 360 y 1440 px, claro y oscuro: carga vacía, con típicos, con errores,
con advertencias (barberos), lista para guardar y resumen. axe con 0 errores en todas. Completar una carga solo con el
teclado.
