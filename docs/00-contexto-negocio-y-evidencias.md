# 00. Contexto del negocio, problema, objetivos y evidencias

> Este capítulo cubre el paso 1 del proceso del curso (necesidad del negocio). Distingue **dato comprobado** (con fuente), **observación**, **hipótesis a validar** y **decisión de diseño propia**. Fecha de consulta de las fuentes: 12 de octubre de 2026.

## 1. Necesidad del negocio

**Necesidad.** Las barberías de Ayacucho necesitan organizar sus citas, barberos, servicios y clientes sin cruces de horario, sin depender de la memoria o de cuadernos, y sin pagar el desarrollo de un sistema propio. La plataforma debe permitirles empezar con una **prueba gratuita** y continuar con una **suscripción** si les resulta útil.

**Objetivos del negocio (propuestos, por validar con trabajo de campo):**

| ID  | Objetivo del negocio                                     | Indicador propuesto                                     |
| --- | -------------------------------------------------------- | ------------------------------------------------------- |
| OB1 | Reducir cruces de horarios y citas olvidadas             | Cruces por semana antes/después (medición en piloto)    |
| OB2 | Dar a cada barbería su propio espacio con datos aislados | 0 incidentes de acceso entre barberías                  |
| OB3 | Convertir barberías de prueba gratuita en suscriptoras   | Tasa de conversión prueba → suscripción (piloto)        |
| OB4 | Operar con costo bajo y crecer sin reescribir el sistema | Costo mensual de infraestructura; instancias necesarias |

## 2. Planteamiento del problema

### 2.1 Clasificación de las afirmaciones

| Tipo                           | Afirmación                                                                                         | Respaldo                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Dato comprobado (nacional)** | A fines de 2024 había 2 346 592 empresas formales y 2 326 126 eran MYPE (99,1 %)                   | E-05, fuente secundaria (ProActivo citando a PRODUCE)             |
| **Dato comprobado (regional)** | En Ayacucho, en el III trimestre de 2024 hubo 1 214 altas y 1 078 bajas de empresas                | E-02, INEI (primaria)                                             |
| **Dato comprobado (nacional)** | En 2023 los salones de belleza fueron la única actividad con más altas que bajas (tasa neta 0,9 %) | E-04, INEI (primaria, fragmento)                                  |
| **Dato comprobado (nacional)** | En el III T 2024, el 80,2 % de la población de 6 años o más usó Internet (rural: 56,1 %)           | D-01, secundaria (Andina citando al INEI)                         |
| **Dato comprobado (nacional)** | El 90 % de los usuarios de Internet accedió por celular                                            | D-02, secundaria                                                  |
| **Hipótesis**                  | Muchas barberías de Huamanga gestionan citas por llamada, WhatsApp o cuaderno                      | **Por validar** en campo (pregunta 2 del guion)                   |
| **Hipótesis**                  | Los cruces de horario y las inasistencias son frecuentes y cuestan ingresos                        | **Por validar** (pregunta 3)                                      |
| **Hipótesis**                  | Los propietarios aceptarían pagar una suscripción mensual con Yape o tarjeta                       | **Por validar** (preguntas 5 y 10)                                |
| **Supuesto**                   | Barberos y clientes cuentan con celular con navegador                                              | Respaldado a nivel nacional (D-02); para Ayacucho **por validar** |
| **Decisión propia**            | Plataforma solo web, responsive                                                                    | Ver RC01 y ADR-001                                                |

### 2.2 Problema

La gestión manual de citas, horarios, servicios y clientes provoca (hipótesis) cruces de agenda, pérdida de información y poca visibilidad del negocio. Las soluciones aisladas (hojas de cálculo, mensajería) no ofrecen aislamiento de datos entre negocios, control de roles, reservas sin duplicados ni reportes, y las soluciones genéricas pueden no adaptarse al tamaño ni al presupuesto de una barbería local. Además, un sistema que atiende a varias barberías debe impedir que una vea los datos de otra y debe crecer sin reescribirse.

**No existe un dato oficial desagregado del número de barberías de Ayacucho** (ver brechas en la sección 8). El tamaño del mercado local queda **por estimar** con consulta CIIU en SUNAT, licencias de la Municipalidad Provincial de Huamanga y conteo en campo.

## 3. Justificación

| Perspectiva    | Justificación                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operativa      | Centraliza agenda, servicios, barberos y clientes; evita cruces con control en base de datos                                                                                                                                                                  |
| Económica      | Modelo SaaS con prueba gratuita; una sola infraestructura compartida reduce el costo por barbería. El 99,1 % de las empresas formales del país son MYPE (E-05), segmento al que apunta el producto                                                            |
| Tecnológica    | Acceso por navegador; a nivel nacional el 90 % de los usuarios de Internet usa celular (D-02), por lo que el diseño es _responsive_                                                                                                                           |
| Arquitectónica | Aislamiento multi-tenant, modularidad (monolito modular), seguridad, rendimiento y escalabilidad horizontal con balanceador                                                                                                                                   |
| Comercial      | Prueba gratuita + planes; la dinámica empresarial de Ayacucho (altas de empresas 1 214 en el III T 2024, E-02) y la de salones de belleza (E-04) sugieren demanda de servicios personales, **sin que esto pruebe la demanda de software**: se valida en campo |

## 4. Objetivos

**General.** Diseñar la arquitectura de software de la plataforma SaaS, considerando aislamiento de datos, mantenibilidad, seguridad, escalabilidad e integración de servicios externos.

**Específicos.**

1. Identificar actores, necesidades, historias de usuario, requisitos funcionales y restricciones.
2. Definir atributos de calidad (con escenarios medibles) y drivers arquitectónicos.
3. Seleccionar y justificar el estilo de monolito modular.
4. Diseñar la arquitectura lógica de cuatro capas con enfoque Clean Architecture y los módulos del sistema.
5. Definir la estrategia multi-tenant y el modelo de persistencia.
6. Diseñar la integración de IA, pagos, suscripciones, caché y balanceo de carga.
7. Documentar la arquitectura con C4 (4 niveles), UML y ADR.
8. Planificar el desarrollo con Scrum y especificaciones SDD.
9. Establecer criterios y evidencias para verificar calidad y viabilidad, con trazabilidad requisito → decisión → componente → prueba.

## 5. Alcance y limitaciones

**Dentro del alcance (documentación y diseño):** notificación al cliente de la fecha y hora de su cita por **correo electrónico y por WhatsApp** (según su preferencia y consentimiento); los seis módulos descritos en [estilo-arquitectonico.md](02-arquitectura-software/estilo-arquitectonico.md); diagramas C4 niveles 1 a 4; ADR; plan Scrum/SDD; pruebas y riesgos planificados.

**Fuera del alcance (evolución futura):**

| Elemento                                               | Motivo                                                                   | Estado |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| Aplicación móvil nativa (Play Store / App Store)       | La plataforma es solo web; se documenta únicamente como evolución futura | Futuro |
| Pago de citas por parte de clientes                    | Fuera del MVP; los pagos cubren solo la suscripción de barberías         | Futuro |
| Dominios propios por tenant y base dedicada por tenant | Complejidad y costo; se prevén como evolución                            | Futuro |
| Otros canales de notificación (por ejemplo, SMS)       | Los canales incluidos son correo y WhatsApp                              | Futuro |
| Microservicios                                         | Solo si hay necesidad demostrada                                         | Futuro |

**Limitaciones.** Muestra de campo por conveniencia; sin marco muestral oficial de barberías; las medidas de calidad son propuestas por validar; el proveedor de pagos y de IA no está contratado.

## 6. Marco legal: datos personales

La plataforma trata datos de clientes (nombre, teléfono, correo, historial de citas). Aplican la **Ley N.° 29733** y su nuevo reglamento (**D. S. N.° 016-2024-JUS**, publicado el 30-11-2024 y vigente desde el 30-03-2025 según fuentes secundarias; **verificar en _El Peruano_ antes de citar**).

| Tema                                                                                                       | Tratamiento en el diseño                                                                                                                                                                                                                                                                            | Estado      |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Consentimiento previo, informado, expreso e inequívoco                                                     | RF05, EQ-18 (registro de consentimiento)                                                                                                                                                                                                                                                            | Planificado |
| Responsable y encargado del tratamiento                                                                    | **Propuesta por validar con asesoría legal:** cada barbería es _responsable_ de los datos de sus clientes y la plataforma es _encargada_ (trata los datos por cuenta de la barbería). Para los datos de las propias barberías-cliente de la plataforma (propietarios), la plataforma es responsable | Por validar |
| Inscripción de bancos de datos (RNPDP)                                                                     | Actividad de cumplimiento a evaluar antes de operar                                                                                                                                                                                                                                                 | Por validar |
| Respaldos al menos semanales, trazabilidad de accesos, notificación de incidentes graves a la ANPD en 48 h | EQ-13, EQ-21, EQ-22, riesgo R12 y procedimiento de incidentes                                                                                                                                                                                                                                       | Planificado |
| Oficial de Datos Personales (calendario por tamaño de empresa)                                             | Evaluar si corresponde; **no se afirma** sin análisis                                                                                                                                                                                                                                               | Por validar |

_Este documento no constituye asesoría legal definitiva._

## 7. Tabla de evidencias

| Dato                                                                                                               | Nivel    | Fuente                                             | Año   | Estado de verificación                   |
| ------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------- | ----- | ---------------------------------------- |
| E-01 3 409 102 empresas activas al 30-09-2024                                                                      | Nacional | INEI, Demografía empresarial III T 2024, Cuadro 01 | 2024  | Primaria                                 |
| E-02 Ayacucho: 1 214 altas (1 128 en 2023) y 1 078 bajas (1 713 en 2023)                                           | Regional | INEI, mismo informe, Cuadro 03                     | 2024  | Primaria                                 |
| E-03 Ayacucho, personas naturales: 873 altas (697) y 535 bajas (801); 51,7 % de las altas con conducción masculina | Regional | INEI, mismo informe, Cuadro 06                     | 2024  | Primaria                                 |
| E-04 Salones de belleza: altas 2,5 %, bajas 1,6 %, neta 0,9 %                                                      | Nacional | INEI, Demografía empresarial III T 2023            | 2023  | Primaria (fragmento)                     |
| E-05 2 346 592 empresas formales; 2 326 126 MYPE (99,1 %); MYPE 20,2 % del PBI                                     | Nacional | PRODUCE vía ProActivo                              | 2024  | **Secundaria**                           |
| A-01 Población proyectada de Ayacucho 660 379                                                                      | Regional | INEI vía Congreso                                  | 2025  | Secundaria                               |
| A-04 PEA ocupada 364 312; desempleo 4,2 %; empleo formal 14,5 %                                                    | Regional | MTPE, reporte de empleo formal en Ayacucho         | 2025  | Primaria                                 |
| A-05 Empleo privado formal: servicios 9 844 (50,4 %), minería 4 040, comercio 3 367                                | Regional | MTPE, Planilla Electrónica                         | 2025  | Primaria                                 |
| D-01 80,2 % usó Internet (rural 56,1 %; resto urbano 82,9 %; Lima Metropolitana 89,9 %)                            | Nacional | INEI (ENAHO) vía Andina                            | 2024  | **Secundaria**                           |
| D-02 90 % de usuarios de Internet por celular; 94,9 % de hogares con celular                                       | Nacional | Misma nota                                         | 2024  | **Secundaria**                           |
| D-03 Más de 105 millones de operaciones mensuales con billeteras móviles (enero 2024)                              | Nacional | BCRP vía BBVA                                      | 2024  | **Secundaria**                           |
| D-04/D-05/D-06 Condiciones de Yape, billeteras QR, webhooks y tokens                                               | Técnico  | Documentación de Culqi                             | s. f. | Primaria (del proveedor)                 |
| L-01/L-02/L-03 Ley 29733 y D. S. 016-2024-JUS                                                                      | Nacional | laley.pe, Pérez Llorca                             | 2024  | **Secundaria: verificar en El Peruano**  |
| T-01/T-02 Flujo y comandos de Spec Kit                                                                             | Técnico  | github/spec-kit                                    | s. f. | Primaria, verificar con `specify --help` |

**Notas.**

- Las tres cifras de población de Ayacucho (616 176 en 2017; 670 377 en 2023; 660 379 proyectada 2025) corresponden a años y proyecciones distintas. Este documento cita **una sola por contexto** (660 379, proyección 2025, fuente secundaria) y no las compara.
- El texto del reporte del MTPE da porcentajes (servicios 5,0 %, minería 2,1 %) que no coinciden con su propia tabla; se usa la tabla (total 19 539, cálculo propio).
- No se usan las cifras "28 millones de cuentas de Yape y Plin" ni "más de 10 millones de usuarios de Yape" por carecer de fuente.
- Cálculo propio (no publicado por el INEI): altas menos bajas de empresas en Ayacucho, III T 2024 = 136.

## 8. Brechas de información y cómo cerrarlas

| Brecha                                           | Dónde obtenerlo                                                                                                                                  | Cómo se declara                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Número de barberías de Ayacucho / Huamanga       | Consulta por actividad CIIU Rev. 4 clase 9602 en SUNAT (verificar código); licencias de la Municipalidad Provincial de Huamanga; conteo en campo | "No existe dato oficial desagregado; se estimará o relevará" |
| MYPE formales de Ayacucho                        | PRODUCE (anuario); INEI, Directorio Central de Empresas por departamento                                                                         | Dato regional por completar                                  |
| Internet y celular en Ayacucho                   | INEI, ENAHO, cuadros por departamento (módulo TIC)                                                                                               | Hasta tenerlo, solo cifras nacionales, dichas como tales     |
| Pagos digitales en negocios pequeños de Ayacucho | Encuesta propia; informes BCRP/SBS de inclusión financiera                                                                                       | Hipótesis a validar                                          |
| Disposición a pagar                              | Entrevistas y análisis de competencia                                                                                                            | Precios hipotéticos, nunca "de mercado"                      |

## 9. Guía de trabajo de campo (Sprint 1)

Muestra **por conveniencia** de 8 a 15 barberías de Huamanga (declarada como limitación). Con **consentimiento informado** y sin registrar datos personales innecesarios. Preguntas:

1. ¿Cuántos barberos trabajan y cuántas citas atienden en un día normal?
2. ¿Cómo reciben hoy las reservas (llamada, WhatsApp, presencial) y cómo llevan la agenda?
3. ¿Con qué frecuencia ocurren cruces de horarios, clientes que no llegan o citas olvidadas?
4. ¿Qué información de clientes y servicios guardan y dónde?
5. ¿Qué medios de pago aceptan (efectivo, Yape, Plin, tarjeta)?
6. ¿Usan alguna aplicación o sistema de agenda? ¿Cuál y cuánto pagan?
7. ¿Qué dispositivos usan y qué tan seguido tienen Internet?
8. ¿Qué datos del negocio les gustaría ver?
9. ¿Qué les preocuparía de usar un sistema en línea (costo, privacidad, uso)?
10. ¿Cuánto estarían dispuestos a pagar al mes y qué haría valer ese costo?

Con las respuestas se contrastan las hipótesis de la sección 2.1 y se ajustan requisitos y precios referenciales. Resultados: **pendientes** (no se presentan como hechos).

## 10. Referencias (APA 7)

Agencia Andina. (2024, 27 de diciembre). _INEI: Uso de internet alcanzó al 80.2% de la población de 6 y más años de edad_. https://andina.pe/agencia/noticia-inei-uso-internet-alcanzo-al-802-de-poblacion-6-y-mas-anos-edad-1012997.aspx

BBVA Perú. (2025, 29 de octubre). _Las billeteras digitales crecen como medio de pago en Perú_. https://www.bbva.com/es/pe/salud-financiera/las-billeteras-digitales-crecen-como-medio-de-pago-en-peru/

Congreso de la República del Perú. (2025). _Carpeta georreferencial: Ayacucho_. https://www.congreso.gob.pe/Docs/DGP/GestionInformacionEstadistica/files/carp-geo-2025/ene-25-car-geo-ayacucho.pdf

Culqi. (s. f.). _Cargos únicos: Yape_. https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens-yape/

Culqi. (s. f.). _Órdenes de pago: Billeteras móviles_. https://docs.culqi.com/es/documentacion/pagos-online/ordenes-de-pago/billetera-moviles/

Culqi. (s. f.). _Tokens_. https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens

GitHub. (s. f.). _github/spec-kit_ [Repositorio]. https://github.com/github/spec-kit

Instituto Nacional de Estadística e Informática. (2023). _Demografía empresarial en el Perú: III trimestre de 2023_ [Informe técnico]. https://m.inei.gob.pe/media/MenuRecursivo/boletines/informe_demografia_empresarial_3t2023.pdf

Instituto Nacional de Estadística e Informática. (2024). _Demografía empresarial en el Perú: III trimestre de 2024_ [Informe técnico]. https://www.inei.gob.pe/media/MenuRecursivo/boletines/demografia_empresarial_3t24.pdf

Ministerio de Trabajo y Promoción del Empleo. (2025). _Reporte del empleo formal en la región Ayacucho a febrero 2025_. https://cdn.www.gob.pe/uploads/document/file/8148394/6822649-05-ayacucho.pdf

ProActivo. (2025, 19 de mayo). _Las MYPE constituyen el 99,1 % de empresas formales en Perú_. https://proactivo.com.pe/las-mypes-constituyen-el-99-1-de-empresas-formales-en-peru/

_Pendiente de localizar la fuente primaria:_ Decreto Supremo N.° 016-2024-JUS (_El Peruano_, 30-11-2024) y la nota de PRODUCE sobre empresas formales 2024.
