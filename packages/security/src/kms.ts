export interface KeyMaterial {
  key: Uint8Array;
  version: string;
}

export interface KeyProvider {
  currentKey(): Promise<KeyMaterial>;
  keyForVersion(version: string): Promise<Uint8Array | null>;
}

export class EnvironmentKeyProvider implements KeyProvider {
  private constructor(private readonly material: KeyMaterial) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): EnvironmentKeyProvider {
    if (environment.NODE_ENV === 'production') {
      throw new Error('local key provider is disabled in production');
    }
    const encodedKey = environment.VAULT_LOCAL_KEY_BASE64;
    const version = environment.VAULT_LOCAL_KEY_VERSION;
    if (!encodedKey || !version) {
      throw new Error('vault key configuration is unavailable');
    }
    if (environment.KMS_PROVIDER !== 'local') {
      throw new Error('configured key provider is unavailable');
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
      throw new Error('vault key configuration is unavailable');
    }
    return new EnvironmentKeyProvider({ key, version });
  }

  async currentKey(): Promise<KeyMaterial> {
    return this.material;
  }

  async keyForVersion(version: string): Promise<Uint8Array | null> {
    return version === this.material.version ? this.material.key : null;
  }
}
