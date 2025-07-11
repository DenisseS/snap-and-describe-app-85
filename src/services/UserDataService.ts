
import { DataState, UserProfile } from '@/types/userData';
import DropboxService, { UserInfo as DropboxUserInfo } from './DropboxService';

// Tipos para el sistema de eventos
type UserDataEvent = 'profile-updated' | 'profile-sync-start' | 'profile-sync-end' | 'profile-error';
type EventListener = (data?: any) => void;

class UserDataService {
  private static instance: UserDataService;
  private dropboxService: DropboxService | null = null;
  
  // Sistema de eventos reactivo
  private eventListeners: Map<UserDataEvent, Set<EventListener>> = new Map();

  private constructor() {
    // Inicializar event listeners
    this.eventListeners.set('profile-updated', new Set());
    this.eventListeners.set('profile-sync-start', new Set());
    this.eventListeners.set('profile-sync-end', new Set());
    this.eventListeners.set('profile-error', new Set());
  }

  public static getInstance(): UserDataService {
    if (!UserDataService.instance) {
      UserDataService.instance = new UserDataService();
    }
    return UserDataService.instance;
  }

  public setDropboxService(service: DropboxService): void {
    if (!this.dropboxService) {
      this.dropboxService = service;
      console.log('📊 UserDataService: DropboxService configured');
    }
  }

  // Sistema de eventos
  public addEventListener(event: UserDataEvent, listener: EventListener): void {
    this.eventListeners.get(event)?.add(listener);
  }

  public removeEventListener(event: UserDataEvent, listener: EventListener): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  private emitEvent(event: UserDataEvent, data?: any): void {
    console.log(`📊 UserDataService: Emitting event ${event}`, data);
    this.eventListeners.get(event)?.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error(`📊 UserDataService: Error in event listener for ${event}:`, error);
      }
    });
  }

  // Método principal para obtener perfil de usuario
  public async getUserProfile(): Promise<{
    data: UserProfile | null;
    state: DataState;
  }> {
    console.log('📊 UserDataService: Getting user profile...');
    
    if (!this.dropboxService?.isAuthenticated()) {
      console.log('📊 UserDataService: Not authenticated, returning null');
      return {
        data: null,
        state: DataState.IDLE
      };
    }

    try {
      const userInfo = await this.dropboxService.getUserInfo();
      
      if (userInfo) {
        const profile: UserProfile = { 
          nombre: userInfo.nombre,
          allergies: userInfo.allergies || {},
          favorites: userInfo.favorites || {}
        };
        
        console.log('📊 UserDataService: Profile loaded successfully');
        
        return {
          data: profile,
          state: DataState.READY
        };
      }
    } catch (error) {
      console.error('📊 UserDataService: Error fetching user profile:', error);
    }

    return {
      data: null,
      state: DataState.ERROR
    };
  }

  // Update optimista para perfil completo
  public async updateUserProfile(profile: UserProfile, onUpdate?: (profile: UserProfile) => void): Promise<{
    success: boolean;
    state: DataState;
  }> {
    console.log('📊 UserDataService: Updating profile...', profile);
    
    if (!this.dropboxService?.isAuthenticated()) {
      return { success: false, state: DataState.ERROR };
    }

    try {
      this.emitEvent('profile-sync-start');
      
      // Actualizar usando DropboxService con callback optimista
      const dropboxUserInfo: DropboxUserInfo = { 
        nombre: profile.nombre,
        allergies: profile.allergies,
        favorites: profile.favorites
      };
      
      const success = await this.dropboxService.updateUserInfo(dropboxUserInfo);
      
      if (success) {
        // Emitir evento de actualización optimista
        this.emitEvent('profile-updated', profile);
        onUpdate?.(profile);
        this.emitEvent('profile-sync-end');
        console.log('📊 UserDataService: Profile updated successfully');
        
        return { success: true, state: DataState.READY };
      } else {
        await this.handleSyncError(onUpdate);
        return { success: false, state: DataState.ERROR };
      }
    } catch (error) {
      console.error('📊 UserDataService: Error updating user profile:', error);
      await this.handleSyncError(onUpdate);
      return { success: false, state: DataState.ERROR };
    }
  }

  // Manejo de errores con rollback
  private async handleSyncError(onUpdate?: (profile: UserProfile) => void): Promise<void> {
    console.log('📊 UserDataService: Sync failed, pulling real data from Dropbox...');
    
    try {
      const realData = await this.dropboxService!.getUserInfo();
      
      if (realData) {
        const realProfile: UserProfile = { 
          nombre: realData.nombre,
          allergies: realData.allergies || {},
          favorites: realData.favorites || {}
        };
        
        this.emitEvent('profile-updated', realProfile);
        this.emitEvent('profile-error', 'Sync failed, rolled back to server data');
        onUpdate?.(realProfile);
        console.log('📊 UserDataService: Rollback completed');
      }
    } catch (pullError) {
      console.error('📊 UserDataService: Error during rollback:', pullError);
      this.emitEvent('profile-error', pullError);
    }
  }

  // Limpiar cache - ahora delega a DropboxService
  public clearUserCache(): void {
    console.log('📊 UserDataService: Clearing user data cache...');
    
    // Limpiar cache genérico de archivos de Dropbox
    const keys = Object.keys(localStorage);
    const dropboxKeys = keys.filter(key => key.startsWith('DROPBOX_FILE_'));
    
    dropboxKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    // También limpiar claves USER_ por compatibilidad
    const userKeys = keys.filter(key => key.startsWith('USER_'));
    userKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log(`📊 UserDataService: Cache cleared: ${dropboxKeys.length + userKeys.length} keys removed`);
  }
}

export default UserDataService;
