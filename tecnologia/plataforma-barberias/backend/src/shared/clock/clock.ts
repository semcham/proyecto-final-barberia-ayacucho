/** Puerto de reloj: permite probar vencimientos sin depender de la hora real. */
export abstract class Clock {
  abstract ahora(): Date;
}

export class RelojDelSistema extends Clock {
  ahora(): Date {
    return new Date();
  }
}
