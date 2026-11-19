# Semilla de demostración (funcionalidad 009, US3)

Carga dos barberías de ejemplo **por la API pública**, como lo haría una persona: registro de la barbería, horario,
servicios, barberos, clientes y citas. No usa ningún rol de base de datos, así que la aplicación aplica sus propias
reglas: aislamiento por barbería, RLS, hash de contraseñas y consentimiento. Es **idempotente**: una segunda carga
dice "0 creadas" y **no cambia ninguna contraseña**.

## Uso

Con la demo levantada (`docker compose up -d`), desde `tecnologia/plataforma-barberias/`:

```bash
docker compose --profile herramientas run --rm semilla
```

Desde el equipo, con Node 22 o mayor:

```bash
node semilla/cargar-semilla.mjs --api http://localhost:3000/api/v1
```

La semilla **no** se carga sola al levantar la demo: se carga con este comando explícito.

## Cuentas de la demo LOCAL

Estas contraseñas son **valores de desarrollo**, versionados a propósito en `datos.json`. Solo sirven en la demo que
corre en tu propio equipo. La **demo publicada** usa otras contraseñas, generadas al azar y guardadas fuera del
repositorio: no son estas.

| Rol                   | Barbería (enlace)           | Correo                                                                | Contraseña (solo desarrollo) |
| --------------------- | --------------------------- | --------------------------------------------------------------------- | ---------------------------- |
| Propietario           | `/b/barberia-demo-centro`   | `propietario.centro@ejemplo.test`                                     | `DemoLocal-2026-Centro`      |
| Barbero (Carlos Demo) | `/b/barberia-demo-centro`   | `barbero.carlos@ejemplo.test`                                         | `DemoLocal-2026-Barbero`     |
| Clientes 1 a 6        | `/b/barberia-demo-centro`   | `cliente.centro.1@ejemplo.test` … `cliente.centro.6@ejemplo.test`     | `DemoLocal-2026-Cliente`     |
| Propietario           | `/b/barberia-demo-huamanga` | `propietario.huamanga@ejemplo.test`                                   | `DemoLocal-2026-Huamanga`    |
| Clientes 1 a 4        | `/b/barberia-demo-huamanga` | `cliente.huamanga.1@ejemplo.test` … `cliente.huamanga.4@ejemplo.test` | `DemoLocal-2026-Cliente`     |

Los clientes entran desde el enlace de su barbería (`/b/<slug>/ingresar`).

## Qué se siembra

|           | Barbería Demo Centro             | Barbería Demo Huamanga             |
| --------- | -------------------------------- | ---------------------------------- |
| Horario   | Lunes a sábado, de 09:00 a 19:00 | Martes a domingo, de 10:00 a 20:00 |
| Servicios | 4                                | 3                                  |
| Barberos  | 3 (Carlos Demo con su cuenta)    | 2                                  |
| Clientes  | 6                                | 4                                  |
| Citas     | 12 (3 canceladas)                | 8 (2 canceladas)                   |

- **Datos inventados:** ninguna persona real. Los correos son del dominio reservado `ejemplo.test` (RFC 2606/6761)
  y los teléfonos `+51 900 000 0NN` son ficticios.
- **Fechas:** las citas se reservan en los próximos **días de atención** de cada barbería, contados desde el día de
  la carga, y siempre en el futuro.
- **Idempotencia:**
  - una cita ya existe si el cliente tiene otra con el mismo barbero, servicio y hora local, en cualquier fecha;
  - las barberías se reconocen por la cuenta de su propietario y los clientes por la suya;
  - los servicios y barberos, por su nombre.

### Qué no se siembra, y por qué

- **Citas atendidas o del pasado:** la API no permite reservar en el pasado.
- **Citas pendientes de adelanto:** exigen activar el adelanto con el QR de la barbería (008). Las citas sembradas
  nacen confirmadas, y algunas se cancelan.
- **El administrador de la plataforma:** se crea con `npm run plataforma:crear-admin` (en `backend/`), que muestra
  el segundo factor una sola vez.

## Códigos de salida

| Código | Significado                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| 0      | Todo existía o se creó                                                                                        |
| 1      | Error (la API respondió algo inesperado, o una cuenta existe con otra contraseña)                             |
| 3      | Se pasó `--reiniciar-contrasenas` en el modo local: se rechaza, porque el modo local nunca cambia contraseñas |

El modo `--modo publicacion` (contraseñas al azar fuera del repositorio) y su reinicio se construyen en la fase 7
de 009.
