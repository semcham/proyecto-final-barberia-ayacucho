// Violación a propósito (T015 de 003): la capa de aplicación habla HTTP con el proveedor en lugar del puerto.
import { request } from 'node:http';

export const llamar = () => request('http://pasarela');
