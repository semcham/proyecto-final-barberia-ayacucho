import { Injectable, type OnModuleInit } from '@nestjs/common';
import { BarberiasPorEstadoIndicador } from '../modules/suscripciones-pagos';
import { RegistroDeIndicadores } from '../shared';

/**
 * T035 de 007 · Raíz de composición de los indicadores de la plataforma (research R01; nota de ADR-031 sobre el
 * registro): registra en el registro de M06 las fuentes `*-indicador.ts` que aporta cada módulo, como
 * host/tareas.ts con el EjecutorTareas. Cada fuente cuenta solo las tablas de su módulo; M01 consulta el registro
 * en la ruta GET /plataforma/indicadores y audita el acceso. La matriz de dependencias no cambia.
 *
 * Fase 2b: solo las barberías por estado (M03). La fase 2c suma las citas por mes (M02) y los usuarios por tipo
 * (M01), desde las vistas de solo conteo.
 */
@Injectable()
export class IndicadoresDeLaPlataforma implements OnModuleInit {
  constructor(
    private readonly registro: RegistroDeIndicadores,
    private readonly barberiasPorEstado: BarberiasPorEstadoIndicador,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this.barberiasPorEstado);
  }
}
