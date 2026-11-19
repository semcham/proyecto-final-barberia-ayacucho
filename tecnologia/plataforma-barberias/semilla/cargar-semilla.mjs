#!/usr/bin/env node
// Funcionalidad 009 (US3, FR-019; research R04): carga la semilla de demostración por la API PÚBLICA, como un
// usuario. No usa ningún rol de base de datos: el aislamiento, las reglas y el hash de las contraseñas los aplica
// la propia aplicación. Es idempotente y la carga normal no cambia ninguna contraseña.
//
//   node semilla/cargar-semilla.mjs [--api http://localhost:3000/api/v1] [--datos semilla/datos.json]
//                                   [--modo local] [--version-terminos 2026-10] [--version-politica 2026-10]
//
// En Docker Compose: `docker compose --profile herramientas run --rm semilla` (servicio de docker-compose.yml).
// Códigos: 0 todo existe o se creó; 1 error; 3 --reiniciar-contrasenas en el modo local (rechazado).
// El modo `publicacion` y --reiniciar-contrasenas con él se construyen en la fase 7 de 009 (US7).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApi, ErrorApi } from './lib/api.mjs';
import { buscarCitaExistente, diaDeAtencion, inicioIso, mismosTramos } from './lib/idempotencia.mjs';

export const CODIGOS = { OK: 0, ERROR: 1, REINICIO_RECHAZADO: 3 };
const TIPOS = ['barberias', 'horarios', 'servicios', 'usuarios', 'barberos', 'clientes', 'citas'];

function resumenVacio() {
  return Object.fromEntries(TIPOS.map((t) => [t, { creadas: 0, existentes: 0 }]));
}

/**
 * @param {{
 *   api: string, datos: object, fetch?: typeof fetch, modo?: 'local' | 'publicacion',
 *   reiniciarContrasenas?: boolean, hoy?: Date, log?: (texto: string) => void,
 *   versionTerminos?: string, versionPolitica?: string, espera?: (ms: number) => Promise<void>
 * }} o
 */
export async function cargarSemilla(o) {
  const log = o.log ?? ((t) => console.log(t));
  const modo = o.modo ?? 'local';
  const resumen = resumenVacio();
  if (o.reiniciarContrasenas && modo === 'local') {
    return {
      codigo: CODIGOS.REINICIO_RECHAZADO,
      resumen,
      mensaje:
        '--reiniciar-contrasenas se rechaza en el modo local: el volumen de desarrollo es del responsable y la semilla ' +
        'nunca cambia contraseñas. Solo existe para la demo publicada (fase 7 de 009).',
    };
  }
  if (modo !== 'local') {
    return {
      codigo: CODIGOS.ERROR,
      resumen,
      mensaje: `El modo "${modo}" todavía no existe: se construye en la fase 7 de 009.`,
    };
  }

  const api = crearApi({ base: o.api, fetch: o.fetch, espera: o.espera });
  const zona = o.datos.zonaHoraria ?? 'America/Lima';
  const hoy = o.hoy ?? new Date();
  const versionTerminos = o.versionTerminos ?? '2026-10';
  const versionPolitica = o.versionPolitica ?? '2026-10';
  const sumar = (tipo, creada) => (creada ? resumen[tipo].creadas++ : resumen[tipo].existentes++);

  try {
    for (const b of o.datos.barberias) {
      // 1. Propietario y barbería: si su cuenta ya inicia sesión, la barbería existe (la carga normal nunca cambia
      //    contraseñas; si la cuenta existe con otra contraseña, se detiene con un error claro).
      let sesion;
      const ingreso = await api.post(
        '/auth/login',
        { correo: b.propietario.correo, contrasena: b.propietario.contrasena },
        { aceptar: [401] },
      );
      if (ingreso.estado === 200) {
        sesion = ingreso.datos;
        sumar('barberias', false);
      } else {
        const registro = await api.post(
          '/barberias',
          {
            nombreBarberia: b.nombre,
            propietario: b.propietario,
            aceptaciones: { terminosVersion: versionTerminos, politicaDatosVersion: versionPolitica },
          },
          { aceptar: [409] },
        );
        if (registro.estado === 409) {
          throw new Error(
            `La cuenta ${b.propietario.correo} ya existe pero no inicia sesión con la contraseña de datos.json: ` +
              'la semilla no cambia contraseñas. Revisa la demo o usa una base nueva.',
          );
        }
        sesion = registro.datos.sesion;
        sumar('barberias', true);
      }
      const token = sesion.tokenAcceso;
      const slug = sesion.usuario.barberia.slug;
      if (b.slugEsperado && slug !== b.slugEsperado) {
        log(
          `Aviso: la barbería "${b.nombre}" quedó con el enlace /b/${slug} (se esperaba /b/${b.slugEsperado}).`,
        );
      }

      // 2. Horario semanal de la barbería (solo si cambió).
      const horarioActual = await api.get('/barberia/horario', { token });
      if (mismosTramos(horarioActual.datos?.tramos, b.horario)) sumar('horarios', false);
      else {
        await api.put('/barberia/horario', { tramos: b.horario }, { token });
        sumar('horarios', true);
      }

      // 3. Servicios, por nombre.
      const servicios = new Map((await api.get('/servicios', { token })).datos.map((s) => [s.nombre, s.id]));
      for (const s of b.servicios) {
        if (servicios.has(s.nombre)) sumar('servicios', false);
        else {
          const creado = await api.post('/servicios', s, { token });
          servicios.set(s.nombre, creado.datos.id);
          sumar('servicios', true);
        }
      }

      // 4. Cuentas de barbero (por correo): se crean pendientes y se activan con el enlace que devuelve la API.
      const usuarios = (await api.get('/usuarios?pagina=1&tamano=50', { token })).datos?.datos ?? [];
      const usuarioPorCorreo = new Map(usuarios.map((u) => [u.correo, u]));
      for (const x of b.barberos.filter((y) => y.usuario)) {
        const existente = usuarioPorCorreo.get(x.usuario.correo);
        if (existente && existente.estado !== 'PENDIENTE') {
          sumar('usuarios', false);
          continue;
        }
        const enlace = existente
          ? (await api.post(`/usuarios/${existente.id}/activacion`, undefined, { token })).datos.enlace
          : await (async () => {
              const creado = await api.post(
                '/usuarios',
                { nombre: x.usuario.nombre, correo: x.usuario.correo, rol: 'BARBERO' },
                { token },
              );
              usuarioPorCorreo.set(x.usuario.correo, creado.datos.usuario);
              return creado.datos.activacion.enlace;
            })();
        const tokenActivacion = new URL(enlace).searchParams.get('token');
        await api.post('/auth/activar', { token: tokenActivacion, contrasena: x.usuario.contrasena });
        sumar('usuarios', !existente);
      }

      // 5. Barberos (por nombre) y su disponibilidad = horario de la barbería.
      const barberos = new Map((await api.get('/barberos', { token })).datos.map((x) => [x.nombre, x.id]));
      for (const x of b.barberos) {
        if (barberos.has(x.nombre)) sumar('barberos', false);
        else {
          const creado = await api.post(
            '/barberos',
            {
              nombre: x.nombre,
              servicioIds: x.servicios.map((n) => servicios.get(n)),
              ...(x.usuario ? { usuarioId: usuarioPorCorreo.get(x.usuario.correo).id } : {}),
            },
            { token },
          );
          barberos.set(x.nombre, creado.datos.id);
          sumar('barberos', true);
        }
        const id = barberos.get(x.nombre);
        const disponibilidad = await api.get(`/barberos/${id}/disponibilidad`, { token });
        if (!mismosTramos(disponibilidad.datos?.tramos, b.horario)) {
          await api.put(`/barberos/${id}/disponibilidad`, { tramos: b.horario }, { token });
        }
      }

      // 6. Clientes por el enlace de la barbería: si ya inician sesión, existen.
      const tokensClientes = new Map();
      for (const c of b.clientes) {
        const ingresoCliente = await api.post(
          '/auth/login',
          { correo: c.correo, contrasena: c.contrasena, barberia: slug },
          { aceptar: [401] },
        );
        if (ingresoCliente.estado === 200) {
          tokensClientes.set(c.correo, ingresoCliente.datos.tokenAcceso);
          sumar('clientes', false);
          continue;
        }
        const registro = await api.post(
          '/clientes/registro',
          {
            barberia: slug,
            nombre: c.nombre,
            correo: c.correo,
            telefono: c.telefono,
            contrasena: c.contrasena,
            aceptaPoliticaDatos: true,
            versionPoliticaDatos: versionPolitica,
          },
          { aceptar: [409] },
        );
        if (registro.estado === 409) {
          throw new Error(
            `La cuenta de cliente ${c.correo} ya existe pero no inicia sesión con la contraseña de datos.json.`,
          );
        }
        tokensClientes.set(c.correo, registro.datos.tokenAcceso);
        sumar('clientes', true);
      }

      // 7. Citas reservadas por cada cliente; algunas se cancelan. Idempotencia: mismo barbero, servicio y hora local.
      const citasPorCliente = new Map();
      for (const entrada of b.citas) {
        const tokenCliente = tokensClientes.get(entrada.cliente);
        if (!citasPorCliente.has(entrada.cliente)) {
          const pagina = await api.get('/clientes/yo/citas?pagina=1&tamano=50', { token: tokenCliente });
          citasPorCliente.set(entrada.cliente, pagina.datos?.elementos ?? []);
        }
        let cita = buscarCitaExistente(citasPorCliente.get(entrada.cliente), entrada, zona);
        if (cita) sumar('citas', false);
        else {
          const fecha = diaDeAtencion(entrada.diaDeAtencion, hoy, b.horario, zona);
          const reserva = await api.post(
            '/citas',
            {
              servicioId: servicios.get(entrada.servicio),
              barberoId: barberos.get(entrada.barbero),
              inicio: inicioIso(fecha, entrada.hora, zona),
            },
            {
              token: tokenCliente,
              cabeceras: { 'idempotency-key': api.claveIdempotencia() },
              aceptar: [409],
            },
          );
          if (reserva.estado === 409) {
            // Horario ocupado: la cita (u otra en su lugar) ya está; no es un error de la semilla.
            sumar('citas', false);
            continue;
          }
          cita = reserva.datos;
          citasPorCliente.get(entrada.cliente).push(cita);
          sumar('citas', true);
        }
        if (entrada.cancelar && cita.estado !== 'CANCELADA') {
          const cancelada = await api.post(`/citas/${cita.id}/cancelar`, {}, { token: tokenCliente });
          cita.estado = cancelada.datos?.estado ?? 'CANCELADA';
        }
      }
      log(`Barbería "${b.nombre}" lista: /b/${slug}`);
    }
  } catch (error) {
    const mensaje = error instanceof ErrorApi || error instanceof Error ? error.message : String(error);
    return { codigo: CODIGOS.ERROR, resumen, mensaje };
  }

  return { codigo: CODIGOS.OK, resumen, mensaje: 'Semilla cargada.' };
}

function argumentos(argv) {
  const o = {
    api: process.env.SEMILLA_API ?? 'http://localhost:3000/api/v1',
    datos: fileURLToPath(new URL('./datos.json', import.meta.url)),
    modo: 'local',
    reiniciarContrasenas: false,
    versionTerminos: process.env.SEMILLA_VERSION_TERMINOS ?? '2026-10',
    versionPolitica: process.env.SEMILLA_VERSION_POLITICA ?? '2026-10',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api') o.api = argv[++i];
    else if (a === '--datos') o.datos = argv[++i];
    else if (a === '--modo') o.modo = argv[++i];
    else if (a === '--reiniciar-contrasenas') o.reiniciarContrasenas = true;
    else if (a === '--version-terminos') o.versionTerminos = argv[++i];
    else if (a === '--version-politica') o.versionPolitica = argv[++i];
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return o;
}

async function principal() {
  let o;
  try {
    o = argumentos(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return CODIGOS.ERROR;
  }
  const datos = JSON.parse(readFileSync(resolve(o.datos), 'utf8'));
  const r = await cargarSemilla({ ...o, datos });
  for (const tipo of TIPOS)
    console.log(`  ${tipo}: ${r.resumen[tipo].creadas} creadas, ${r.resumen[tipo].existentes} existentes`);
  const creadas = TIPOS.reduce((s, t) => s + r.resumen[t].creadas, 0);
  if (r.codigo === CODIGOS.OK)
    console.log(creadas === 0 ? 'Semilla: 0 creadas, todo existía.' : `Semilla: ${creadas} creadas.`);
  else console.error(r.mensaje);
  return r.codigo;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await principal();
}
