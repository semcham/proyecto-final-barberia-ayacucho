import { prepararBaseDePrueba } from './test-db';

export default async function globalSetup(): Promise<void> {
  await prepararBaseDePrueba();
}
