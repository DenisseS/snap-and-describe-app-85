import { DataState, UserProfile } from '@/types/userData';
import SessionService, { UserInfo as DropboxUserInfo } from './SessionService';
import { UserJsonData } from '@/types/dropbox-auth';

// Tipos para el sistema de eventos
type UserDataEvent = 'profile-updated' | 'profile-sync-start' | 'profile-sync-end' | 'profile-error';
type EventListener = (data?: any) => void;

class UserDataService {
  private static instance: UserDataService;
  private sessionService: SessionService | null = null;
  
  // Constante para el archivo de usuario
  private static readonly USER_FILE_PATH = '/user.json';
  
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

  public setDropboxService(service: SessionService): void {
    if (!this.sessionService) {
      this.sessionService = service;
      console.log('📊 UserDataService: SessionService configured');
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

  // Método para obtener información del usuario
  public async getUserInfo(): Promise<DropboxUserInfo | null> {
    console.log('📊 UserDataService: Getting user info...');
    
    if (!this.sessionService) {
      console.log('📊 UserDataService: SessionService not configured');
      return null;
    }

    const result = await this.sessionService.getFile(UserDataService.USER_FILE_PATH);
    
    if (!result.data) {
      // Si no hay archivo, crear uno por defecto
      await this.createDefaultUserFile();
      const newResult = await this.sessionService.getFile(UserDataService.USER_FILE_PATH);
      return this.transformUserJsonToUserInfo(newResult.data);
    }

    return this.transformUserJsonToUserInfo(result.data);
  }

  // Método para actualizar información del usuario
  public async updateUserInfo(userInfo: DropboxUserInfo): Promise<boolean> {
    console.log('📊 UserDataService: Updating user info...', userInfo);
    
    if (!this.sessionService) {
      console.log('📊 UserDataService: SessionService not configured');
      return false;
    }

    // Obtener datos actuales para preservar estructura
    const currentResult = await this.sessionService.getFile(UserDataService.USER_FILE_PATH);
    let currentData: UserJsonData = currentResult.data || {
      profile: { name: "Usuario", edad: 30 }
    };

    // Actualizar con nueva información
    const updatedData: UserJsonData = {
      ...currentData,
      profile: {
        ...currentData.profile,
        name: userInfo.nombre
      },
      allergies: userInfo.allergies,
      favorites: userInfo.favorites
    };

    const result = await this.sessionService.updateFile(UserDataService.USER_FILE_PATH, updatedData);
    return result.success;
  }

  // Crear archivo de usuario por defecto
  private async createDefaultUserFile(): Promise<void> {
    if (!this.sessionService) return;
    
    const defaultData: UserJsonData = {
      profile: {
        name: "Usuario",
        edad: 30
      }
    };
    
    await this.sessionService.updateFile(UserDataService.USER_FILE_PATH, defaultData);
  }

  // Transformar UserJsonData a UserInfo
  private transformUserJsonToUserInfo(data: UserJsonData): DropboxUserInfo {
    return {
      nombre: data.profile.name,
      allergies: data.allergies || {},
      favorites: data.favorites || {}
    };
  }

  // Método principal para obtener perfil de usuario
  public async getUserProfile(): Promise<{
    data: UserProfile | null;
    state: DataState;
  }> {
    console.log('📊 UserDataService: Getting user profile...');
    
    try {
      const userInfo = await this.getUserInfo();
      
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
    
    try {
      this.emitEvent('profile-sync-start');
      
      // Actualizar usando getUserInfo/updateUserInfo
      const dropboxUserInfo: DropboxUserInfo = { 
        nombre: profile.nombre,
        allergies: profile.allergies,
        favorites: profile.favorites
      };
      
      const success = await this.updateUserInfo(dropboxUserInfo);
      
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
      const realData = await this.getUserInfo();
      
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

  // Limpiar cache - solo claves de usuario
  public clearUserCache(): void {
    console.log('📊 UserDataService: Clearing user data cache...');
    
    // Solo limpiar claves USER_ 
    const keys = Object.keys(localStorage);
    const userKeys = keys.filter(key => key.startsWith('USER_'));
    
    userKeys.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log(`📊 UserDataService: Cache cleared: ${userKeys.length} keys removed`);
  }
}

export default UserDataService;
