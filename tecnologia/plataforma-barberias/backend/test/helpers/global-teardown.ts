import { liberarBaseDePrueba } from './test-db';

export default async function globalTeardown(): Promise<void> {
  await liberarBaseDePrueba();
}
