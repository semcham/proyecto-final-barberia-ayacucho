import { Injectable, type OnModuleInit } from '@nestjs/common';
import { UsuariosPorTipoIndicador } from '../modules/acceso-barberias';
import { CitasPorMesIndicador } from '../modules/catalogo-citas';
import { BarberiasPorEstadoIndicador } from '../modules/suscripciones-pagos';
import { RegistroDeIndicadores } from '../shared';

/**
 * T035 y T049 de 007 · Raíz de composición de los indicadores de la plataforma (research R01; nota de ADR-031 sobre el
 * registro): registra en el registro de M06 las fuentes `*-indicador.ts` que aporta cada módulo, como host/tareas.ts
 * con el EjecutorTareas. Cada fuente cuenta solo las tablas de su módulo; M01 consulta el registro en la ruta
 * GET /plataforma/indicadores y audita el acceso. La matriz de dependencias no cambia.
 *
 * - M03: las barberías por estado (fase 2b), con columnas que el rol de la plataforma ya leía.
 * - M02 y M01: las citas por mes y los usuarios por tipo (fase 2c), desde las vistas de solo conteo (enmienda 1.7.0).
 */
@Injectable()
export class IndicadoresDeLaPlataforma implements OnModuleInit {
  constructor(
    private readonly registro: RegistroDeIndicadores,
    private readonly barberiasPorEstado: BarberiasPorEstadoIndicador,
    private readonly citasPorMes: CitasPorMesIndicador,
    private readonly usuariosPorTipo: UsuariosPorTipoIndicador,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this.barberiasPorEstado);
    this.registro.registrar(this.citasPorMes);
    this.registro.registrar(this.usuariosPorTipo);
  }
}
