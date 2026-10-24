import { ProviderType } from '@/modules/projects/domain/Project';
import { IProviderAdapter, ProviderMetadata } from '../domain/IProviderAdapter';
import { ProviderAdapter } from './ProviderAdapter';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private adapters: Map<ProviderType, IProviderAdapter> = new Map();

  private constructor() {
    this.register(new ProviderAdapter('vercel'));
    this.register(new ProviderAdapter('netlify'));
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(adapter: IProviderAdapter): void {
    this.adapters.set(adapter.getProviderType(), adapter);
  }

  public getAdapter(type: ProviderType): IProviderAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for provider type: ${type}`);
    }
    return adapter;
  }

  public getAllMetadata(): ProviderMetadata[] {
    return Array.from(this.adapters.values()).map(a => a.getMetadata());
  }
}

export const providerRegistry = ProviderRegistry.getInstance();
