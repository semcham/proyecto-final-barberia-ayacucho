# Guía de validación: Catálogo, citas y cuenta de cliente

**Funcionalidad**: [spec.md](spec.md) · **Contrato**: [contracts/openapi.yaml](contracts/openapi.yaml) ·
**Permisos**: [contracts/rbac.md](contracts/rbac.md) · **Datos**: [data-model.md](data-model.md)

Comprueba de punta a punta que la funcionalidad cumple la especificación. Parte del entorno de 001
([quickstart de 001](../001-registro-acceso-barberia/quickstart.md)): Docker Compose con `db`
(puerto 5433), `backend` (3000) y `frontend` (5173).

## 1. Preparación

1. **Rol nuevo `barberias_publico` (ADR-021).** Los roles son del clúster y `db/init/01-roles.sql`
   solo corre con un volumen nuevo. En una base de desarrollo que ya existe, vuelve a ejecutar el
   script (es idempotente):

   ```powershell
   docker compose exec db psql -U postgres -d barberias -f /docker-entrypoint-initdb.d/01-roles.sql
   ```

2. **Variable nueva** en `.env` (copiar de `.env.example`):
   `DATABASE_URL_PUBLICO=postgres://barberias_publico:barberias_publico_dev@localhost:5433/barberias`.
   Dentro de Compose, el host es `db`.
3. **Migraciones `0009`–`0012`.** Se aplican solas al reiniciar el backend: `docker compose restart backend`.
   En los registros debe aparecer cada una aplicada y ninguna pendiente.

## 2. Pruebas automáticas (deben quedar en verde)

```powershell
cd tecnologia/plataforma-barberias/backend
npm test          # dominio sin infraestructura: CalculadoraHorarios, Cita, HorarioSemanal, ZonaHoraria…
npm run test:int  # Testcontainers: PR09, PR16, PR08, PR13, contrato y casos de uso
npm run test:arch # PR14 con la matriz nueva (M02 → M01) y el pool público confinado
cd ../frontend
npm test          # Vitest + MSW + axe-core en las pantallas nuevas
```

Comprueba en particular:

| Prueba                       | Qué demuestra                                                                                                                                                 | Resultado esperado                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| PR16 `concurrencia-reservas` | 200 reservas simultáneas, mismo barbero y hora, repartidas en 2 instancias                                                                                    | 1 respuesta 201, 199 respuestas 409 `HORARIO_NO_DISPONIBLE`, 0 respuestas 5xx, 1 cita activa en la base |
| PR16 variantes               | Solape parcial; mismo cliente con dos barberos; 50 reintentos con la misma `Idempotency-Key`                                                                  | 1 cita en cada caso                                                                                     |
| PR09 `lectura-publica`       | Permisos exactos de `barberias_publico`; columnas privadas → error de permisos; sin filas de otro tenant; escritura imposible; datos canario ausentes en HTTP | Todo en verde                                                                                           |
| PR09 `cliente-dos-barberias` | Cliente en A y B: el token de A no ve nada de B; `slug` de B ignorado en operaciones autenticadas                                                             | Todo en verde                                                                                           |
| PR09 `funciones-definer`     | `auth_resolver_cuenta` con cuentas de cliente devuelve como máximo una fila, sin parámetro de tenant                                                          | Todo en verde                                                                                           |
| PR08 `rbac`                  | Cada celda de [rbac.md](contracts/rbac.md)                                                                                                                    | Todo en verde                                                                                           |

## 3. Recorrido manual (interfaz en `http://localhost:5173`)

1. **Propietario prepara la barbería (US1).**
   - Ingresar como propietario. En **Barbería**, cargar dirección, teléfono y horario de lunes a
     sábado de 09:00 a 19:00.
   - **Esperado:** un horario con cierre ≤ apertura se rechaza indicando el día.
   - En **Servicios**, crear "Corte" (S/ 20.00, 30 min) y "Barba" (S/ 15.00, 20 min). En
     **Barberos**, crear "Luis" (vinculado a un usuario barbero) y "Ana" (sin usuario), con servicios.
   - En **Disponibilidad**, dar a Luis de 09:00 a 13:00 y de 14:00 a 19:00.
   - **Esperado:** un tramo de 08:00 a 10:00 se rechaza (`FUERA_DEL_HORARIO_DE_ATENCION`).
2. **Catálogo público (US2).**
   - Abrir `http://localhost:5173/b/<slug>` en una ventana privada.
   - **Esperado:** se ven la barbería, los servicios y los barberos. Al elegir "Corte" y una fecha,
     aparecen horas cada 15 minutos con la etiqueta "hora de la barbería".
   - En la pestaña de red, ninguna respuesta de `/api/v1/publico/` contiene correos ni teléfonos de
     clientes o del personal.
   - Un `slug` inexistente muestra "barbería no disponible".
3. **Registro y reserva (US3).**
   - Desde el enlace, registrarse como cliente aceptando la política de datos y reservar Corte con
     Luis.
   - **Esperado:** confirmación con barbería, servicio, barbero, fecha, hora, precio y estado
     CONFIRMADA. La hora ya no aparece libre.
   - Repetir la confirmación con la red en "Offline" y luego "Online": no se crea una segunda cita.
4. **Unión a otra barbería.**
   - Registrar una segunda barbería y abrir su enlace con el mismo cliente.
   - **Esperado:** se pide aceptar la política de esa barbería. Tras aceptar, la sesión queda en la
     barbería nueva y **Mis citas** muestra solo las citas de esa barbería.
5. **Bloqueo con conflicto (US1, escenario 8).**
   - Como Luis, bloquear la franja de la cita reservada.
   - **Esperado:** se muestra la cita afectada y se pide confirmar. Tras confirmar, la cita sigue
     CONFIRMADA y la agenda del propietario la marca "en conflicto".
6. **Agenda y estados (US4).**
   - Como propietario, ver la agenda del día y filtrar por Luis. Como Luis, ver solo sus citas.
   - Registrar una cita presencial para un cliente nuevo (nombre, teléfono, consentimiento verbal).
   - Intentar marcar como completada una cita futura.
   - **Esperado:** se rechaza (`TRANSICION_INVALIDA`).
7. **Cancelación (US5).**
   - Con antelación mínima de 120 min, cancelar como cliente una cita que empieza en más de 2 h y
     otra que empieza en menos de 2 h.
   - **Esperado:** ambas horas vuelven a estar libres; solo la segunda se marca como tardía en la
     agenda.

## 4. Comprobaciones en la base (opcional)

```sql
-- Exactamente una cita activa por barbero y rango (debe devolver 0 filas)
SELECT a.id, b.id FROM appointment a JOIN appointment b
  ON a.tenant_id = b.tenant_id AND a.barber_id = b.barber_id AND a.id < b.id
 AND a.period && b.period
 WHERE a.status IN ('PENDIENTE','CONFIRMADA') AND b.status IN ('PENDIENTE','CONFIRMADA');

-- El rol público no puede leer columnas privadas (debe fallar con permission denied)
SET ROLE barberias_publico; SELECT customer_id FROM appointment LIMIT 1; RESET ROLE;
```

## 5. Criterios de éxito y dónde se miden

| SC             | Medición                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------- |
| SC-001         | PR16                                                                                               |
| SC-002, SC-003 | PR09 (incluida la vía pública)                                                                     |
| SC-004, SC-005 | Prueba de carga de la funcionalidad 006 (EQ-01, EQ-02); en 002, solo la prueba de humo del cálculo |
| SC-006         | Integración de registro y unión: un `consent_record` por barbería                                  |
| SC-007         | Unitarias de `Cita` e integración de cambio de estado con historial                                |
| SC-008         | PR08                                                                                               |
| SC-009         | Integración de cancelación                                                                         |
| SC-010, SC-011 | Recorrido manual cronometrado desde un celular (secciones 3.1 a 3.3)                               |
