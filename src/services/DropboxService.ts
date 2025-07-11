
import { DropboxConfig, UserInfo, UserJsonData, FileMetadata } from '../types/dropbox-auth';
import { TokenManager } from './dropbox/TokenManager';
import { DropboxAPI } from './dropbox/DropboxAPI';
import { DropboxAuthService } from './dropbox/DropboxAuthService';
import { DropboxFileManagerService } from './dropbox/DropboxFileManagerService';

class DropboxService {
  private tokenManager: TokenManager;
  private api: DropboxAPI;
  private authService: DropboxAuthService;
  private fileManager: DropboxFileManagerService;

  constructor(private config: DropboxConfig) {
    this.tokenManager = new TokenManager();
    this.api = new DropboxAPI(config);
    this.authService = new DropboxAuthService(config);
    this.fileManager = new DropboxFileManagerService(this.api);
  }

  // Interceptor: asegurar token válido antes de cada llamada
  private async ensureValidToken(): Promise<string | null> {
    if (!this.tokenManager.hasToken()) {
      return null;
    }

    const tokenData = this.tokenManager.getToken();
    if (!tokenData) return null;

    if (!this.tokenManager.isTokenExpiringSoon()) {
      return tokenData.access_token;
    }

    console.log('🔐 Token expiring soon, attempting refresh...');
    
    if (!tokenData.refresh_token) {
      console.log('🔐 No refresh token available');
      console.error('🔐 FORCED LOGOUT - No refresh token available - User needs to re-authenticate');
      this.logout();
      return null;
    }

    const newTokenData = await this.api.refreshAccessToken(tokenData.refresh_token);
    
    if (newTokenData) {
      this.tokenManager.saveToken(newTokenData);
      console.log('🔐 Token refreshed successfully');
      return newTokenData.access_token;
    }

    console.error('🔐 FORCED LOGOUT - Token refresh failed - User needs to re-authenticate');
    this.logout();
    return null;
  }

  // Generar clave de cache basada en el archivo
  private getCacheKey(filePath: string): string {
    return `DROPBOX_FILE_${filePath.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  }

  private getMetadataKey(filePath: string): string {
    return `${this.getCacheKey(filePath)}_META`;
  }

  // Cache genérico con metadata
  private getCachedFile(filePath: string): { data: any | null; metadata: FileMetadata | null } {
    try {
      const dataKey = this.getCacheKey(filePath);
      const metaKey = this.getMetadataKey(filePath);
      
      const cachedData = localStorage.getItem(dataKey);
      const cachedMeta = localStorage.getItem(metaKey);
      
      const data = cachedData ? JSON.parse(cachedData) : null;
      const metadata = cachedMeta ? JSON.parse(cachedMeta) as FileMetadata : null;
      
      return { data, metadata };
    } catch (error) {
      console.error(`Error reading cached file ${filePath}:`, error);
      return { data: null, metadata: null };
    }
  }

  private setCachedFile(filePath: string, data: any, metadata: FileMetadata): void {
    try {
      const dataKey = this.getCacheKey(filePath);
      const metaKey = this.getMetadataKey(filePath);
      
      localStorage.setItem(dataKey, JSON.stringify(data));
      localStorage.setItem(metaKey, JSON.stringify(metadata));
    } catch (error) {
      console.error(`Error caching file ${filePath}:`, error);
    }
  }

  // Verificar si necesita sync basado en metadata
  private async checkNeedsSync(filePath: string, currentMetadata: FileMetadata | null): Promise<boolean> {
    if (!this.isAuthenticated() || !currentMetadata) {
      return true;
    }

    try {
      const accessToken = await this.ensureValidToken();
      if (!accessToken) return false;

      const remoteMetadata = await this.fileManager.getFileMetadata(accessToken, filePath);
      if (!remoteMetadata) return false;
      
      return remoteMetadata.client_modified !== currentMetadata.client_modified;
    } catch (error) {
      console.error(`Error checking sync for ${filePath}:`, error);
      return false;
    }
  }

  // Método genérico: Cache-first con sync en background
  public async getFile(filePath: string): Promise<{
    data: any | null;
    fromCache: boolean;
  }> {
    console.log(`📁 DropboxService: Getting file ${filePath}...`);
    
    // 1. Obtener del cache inmediatamente
    const { data: cachedData, metadata } = this.getCachedFile(filePath);
    
    if (cachedData) {
      console.log(`📁 DropboxService: File ${filePath} found in cache`);
      
      // Verificar sync en background si está autenticado
      if (this.isAuthenticated()) {
        this.syncInBackground(filePath, metadata);
      }
      
      return {
        data: cachedData,
        fromCache: true
      };
    }

    // 2. Si no hay cache, cargar de remoto
    if (!this.isAuthenticated()) {
      console.log(`📁 DropboxService: Not authenticated, returning null for ${filePath}`);
      return {
        data: null,
        fromCache: false
      };
    }

    try {
      console.log(`📁 DropboxService: Loading ${filePath} from Dropbox...`);
      const accessToken = await this.ensureValidToken();
      if (!accessToken) {
        return { data: null, fromCache: false };
      }

      const remoteData = await this.fileManager.getFile(accessToken, filePath);
      
      if (remoteData) {
        const fileMetadata = await this.fileManager.getFileMetadata(accessToken, filePath);
        const newMetadata: FileMetadata = {
          client_modified: fileMetadata?.client_modified || new Date().toISOString(),
          last_sync: new Date().toISOString(),
          sync_status: 'synced'
        };
        
        this.setCachedFile(filePath, remoteData, newMetadata);
        console.log(`📁 DropboxService: ${filePath} loaded and cached`);
        
        return {
          data: remoteData,
          fromCache: false
        };
      }
    } catch (error) {
      console.error(`📁 DropboxService: Error fetching ${filePath}:`, error);
    }

    return {
      data: null,
      fromCache: false
    };
  }

  // Sync en background sin bloquear UI
  private async syncInBackground(filePath: string, currentMetadata: FileMetadata | null): Promise<void> {
    try {
      const needsSync = await this.checkNeedsSync(filePath, currentMetadata);
      
      if (needsSync) {
        console.log(`📁 DropboxService: Background sync needed for ${filePath}, updating...`);
        
        const accessToken = await this.ensureValidToken();
        if (!accessToken) return;

        const remoteData = await this.fileManager.getFile(accessToken, filePath);
        
        if (remoteData) {
          const fileMetadata = await this.fileManager.getFileMetadata(accessToken, filePath);
          const newMetadata: FileMetadata = {
            client_modified: fileMetadata?.client_modified || new Date().toISOString(),
            last_sync: new Date().toISOString(),
            sync_status: 'synced'
          };
          
          this.setCachedFile(filePath, remoteData, newMetadata);
          console.log(`📁 DropboxService: Background sync completed for ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`📁 DropboxService: Background sync error for ${filePath}:`, error);
    }
  }

  // Update optimista genérico
  public async updateFile(filePath: string, data: any, onUpdate?: (data: any) => void): Promise<{
    success: boolean;
  }> {
    console.log(`📁 DropboxService: Updating file ${filePath}...`, data);
    
    // 1. Update optimista del cache inmediatamente
    const optimisticMetadata: FileMetadata = {
      client_modified: new Date().toISOString(),
      last_sync: new Date().toISOString(),
      sync_status: 'pending'
    };
    
    this.setCachedFile(filePath, data, optimisticMetadata);
    onUpdate?.(data);
    
    // 2. Sync en background con Dropbox
    if (!this.isAuthenticated()) {
      return { success: false };
    }

    try {
      const accessToken = await this.ensureValidToken();
      if (!accessToken) {
        return { success: false };
      }

      const success = await this.fileManager.updateFile(accessToken, filePath, data);
      
      if (success) {
        const syncedMetadata: FileMetadata = {
          ...optimisticMetadata,
          sync_status: 'synced'
        };
        this.setCachedFile(filePath, data, syncedMetadata);
        console.log(`📁 DropboxService: ${filePath} updated successfully`);
        
        return { success: true };
      } else {
        await this.handleSyncError(filePath, onUpdate);
        return { success: false };
      }
    } catch (error) {
      console.error(`📁 DropboxService: Error updating ${filePath}:`, error);
      await this.handleSyncError(filePath, onUpdate);
      return { success: false };
    }
  }

  // Manejo de errores con rollback
  private async handleSyncError(filePath: string, onUpdate?: (data: any) => void): Promise<void> {
    console.log(`📁 DropboxService: Sync failed for ${filePath}, pulling real data...`);
    
    try {
      const accessToken = await this.ensureValidToken();
      if (!accessToken) return;

      const realData = await this.fileManager.getFile(accessToken, filePath);
      
      if (realData) {
        const fileMetadata = await this.fileManager.getFileMetadata(accessToken, filePath);
        const errorMetadata: FileMetadata = {
          client_modified: fileMetadata?.client_modified || new Date().toISOString(),
          last_sync: new Date().toISOString(),
          sync_status: 'error'
        };
        
        this.setCachedFile(filePath, realData, errorMetadata);
        onUpdate?.(realData);
        console.log(`📁 DropboxService: Rollback completed for ${filePath}`);
      }
    } catch (pullError) {
      console.error(`📁 DropboxService: Error during rollback for ${filePath}:`, pullError);
    }
  }

  // Start OAuth flow
  async startAuth(): Promise<void> {
    return this.authService.startAuth();
  }

  // Handle OAuth callback
  async handleCallback(code: string): Promise<boolean> {
    const codeVerifier = localStorage.getItem('dropbox_code_verifier');
    
    if (!codeVerifier) {
      console.log('No code verifier found, review if token was already saved');
      return true;
    }

    const tokenData = await this.api.exchangeCodeForToken(code, codeVerifier);
    
    if (tokenData) {
      this.tokenManager.saveToken(tokenData);
      localStorage.removeItem('dropbox_code_verifier');
      return true;
    }
    
    return false;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.tokenManager.hasToken();
  }

  // Logout
  logout(): void {
    this.tokenManager.clearToken();
  }
}

export default DropboxService;
export type { UserInfo };
