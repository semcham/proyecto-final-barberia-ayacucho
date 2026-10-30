# Principios de diseño (SOLID y complementarios)

| Principio                       | Qué dice                                                      | Ejemplo del proyecto                                                                                                                                      | Qué ocurre si se viola                                               |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **S** Responsabilidad única     | Una clase tiene una sola razón para cambiar                   | `ReservarCita` solo orquesta la reserva; el cálculo de horarios libres está en `ConsultarHorarios`; las reglas del rango en `RangoHorario`                | Un cambio de política de horarios obliga a tocar el flujo de reserva |
| **O** Abierto/cerrado           | Abierto a extensión, cerrado a modificación                   | Agregar un proveedor de pagos implementa un adaptador nuevo de `PaymentGateway` sin editar los casos de uso; agregar un plan es agregar una fila a `plan` | Cada proveedor nuevo exige cambiar condicionales en la lógica        |
| **L** Sustitución de Liskov     | Cualquier implementación del contrato puede reemplazar a otra | `PasarelaSimuladaAdapter` cumple la suite de contrato PR20; el adaptador real (planificado) deberá cumplir la misma                                       | El simulador oculta errores que luego aparecen con el proveedor real |
| **I** Segregación de interfaces | Interfaces pequeñas y específicas                             | `PaymentGateway`, `AlmacenComprobantes`, `TokenSigner`, `PasswordHasher`, `SegundoFactor` y `CacheCompartida` son interfaces separadas                    | Un módulo depende de métodos que no usa                              |
| **D** Inversión de dependencias | Depender de abstracciones, no de implementaciones             | La aplicación define `CitaRepository`; la infraestructura lo implementa; el dominio no importa PostgreSQL ni Redis                                        | Probar una regla requiere base de datos real                         |

## Principios complementarios

| Principio                            | Aplicación                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Separación de responsabilidades**  | Cuatro capas; presentación sin reglas críticas                                                                                         |
| **Alta cohesión, bajo acoplamiento** | Módulos con interfaz pública y matriz de dependencias                                                                                  |
| **DRY con criterio**                 | El constructor de claves de caché y el contexto de tenant son únicos; no se unifican entidades de módulos distintos solo por parecerse |
| **YAGNI**                            | No hay puertos sin riesgo de cambio; no hay microservicios; no hay app móvil                                                           |
| **Fail fast**                        | Validar al borde; errores de dominio explícitos (`HorarioNoDisponible`, `TransicionInvalida`)                                          |
| **Mínimo privilegio**                | Cada rol y rol de base de datos solo con lo necesario                                                                                  |
| **Idempotencia**                     | Operaciones externas repetibles sin efectos dobles                                                                                     |

## Cómo se comprueba

- PR14: prueba de arquitectura que falla si el dominio importa infraestructura o si un módulo viola la matriz (`backend/test/architecture/reglas.spec.ts`, 24/24 en verde).
- PR20: pruebas de contrato del puerto de pagos (`backend/test/integration/pagos/gateway-simulado.spec.ts`).
- Revisión de código con lista de verificación SOLID en cada _pull request_.
