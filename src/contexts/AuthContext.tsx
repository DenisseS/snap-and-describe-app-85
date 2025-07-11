import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import SessionService, { UserInfo } from '../services/SessionService';
import UserDataService from '../services/UserDataService';
import { AuthState, AuthStateData } from '../types/auth';
import { useUserCache } from '../hooks/useUserCache';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

interface AuthContextType {
  // Estado centralizado - AuthState como única fuente de verdad
  authState: AuthState;
  userInfo: UserInfo | null;
  error: string | null;
  
  // Servicios
  sessionService: SessionService;
  
  // Acciones
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserInfo: (userInfo: UserInfo) => Promise<boolean>;
  refreshUserInfo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Create a single instance of SessionService
const sessionService = new SessionService({
  clientId: import.meta.env.VITE_DROPBOX_CLIENT_ID || '',
  redirectUri: `${window.location.origin}/auth/callback`,
});

// Create UserDataService instance and configure it with SessionService
const userDataService = UserDataService.getInstance();
userDataService.setDropboxService(sessionService);

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>(AuthState.LOADING);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { clearUserCache, getUserCacheInfo } = useUserCache();
  const { toast } = useToast();
  const { t } = useTranslation();

  const refreshUserInfo = useCallback(async () => {
    const isAuth = sessionService.isAuthenticated();
    
    if (!isAuth) {
      console.log('🔐 Auth: No authenticated, setting IDLE state');
      setAuthState(AuthState.IDLE);
      return;
    }

    try {
      console.log('🔐 Auth: Refreshing user info...');
      setError(null);
      
      const userInfo = await userDataService.getUserInfo();
      
      if (userInfo) {
        console.log('🔐 Auth: User info loaded successfully', userInfo);
        setUserInfo(userInfo);
        setAuthState(AuthState.AUTHENTICATED);
      } else {
        // Si getUserInfo devuelve null pero no lanzó error, probablemente el usuario fue deslogueado
        console.log('🔐 Auth: User info is null, user may have been logged out');
        setUserInfo(null);
        setAuthState(AuthState.IDLE);
        
        // Mostrar notificación sutil de reautenticación
        toast({
          title: t('connectionError'),
          description: t('authenticationFailed') + '. ' + t('tryAgain'),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('🔐 Auth: Error refreshing user info:', error);
      
      // Si hay error, verificar si es por desautenticación
      if (!sessionService.isAuthenticated()) {
        // Usuario fue deslogueado automáticamente por el servicio
        console.log('🔐 Auth: User was automatically logged out by service');
        setUserInfo(null);
        setAuthState(AuthState.IDLE);
        
        // Mostrar notificación de reautenticación
        toast({
          title: t('connectionError'),
          description: t('authenticationFailed') + '. ' + t('tryAgain'),
          variant: "destructive",
        });
      } else {
        // Error diferente
        setUserInfo(null);
        setAuthState(AuthState.ERROR);
        setError('Error loading user information');
      }
    }
  }, [toast, t]);

  const login = useCallback(async () => {
    try {
      console.log('🔐 Auth: Starting login process...');
      setAuthState(AuthState.LOGGING_IN);
      setError(null);
      
      await sessionService.startAuth();
      // Note: El estado se actualizará cuando regrese del callback
    } catch (error) {
      console.error('🔐 Auth: Login error:', error);
      setAuthState(AuthState.ERROR);
      setError('Error during login');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      console.log('🔐 Auth: Starting logout process...');
      setAuthState(AuthState.LOGGING_OUT);
      setError(null);

      // Limpiar datos del servicio
      sessionService.logout();
      
      // Limpiar cache del usuario
      const cacheInfo = getUserCacheInfo();
      console.log('🔐 Auth: Current user cache:', cacheInfo);
      
      const removedKeys = clearUserCache();
      console.log(`🔐 Auth: Removed ${removedKeys} cache keys during logout`);
      
      // Limpiar estado local
      setUserInfo(null);
      setError(null);
      
      // Pequeño delay para mostrar el spinner
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setAuthState(AuthState.IDLE);
      console.log('🔐 Auth: Logout completed successfully');
      
    } catch (error) {
      console.error('🔐 Auth: Logout error:', error);
      setAuthState(AuthState.ERROR);
      setError('Error during logout');
    }
  }, [clearUserCache, getUserCacheInfo]);

  const updateUserInfo = useCallback(async (newUserInfo: UserInfo): Promise<boolean> => {
    try {
      console.log('🔐 Auth: Updating user info...', newUserInfo);
      const success = await userDataService.updateUserInfo(newUserInfo);
      if (success) {
        setUserInfo(newUserInfo);
        console.log('🔐 Auth: User info updated successfully');
      } else {
        // Si falla la actualización, verificar si el usuario fue deslogueado
        if (!sessionService.isAuthenticated()) {
          console.log('🔐 Auth: User was logged out during update');
          setUserInfo(null);
          setAuthState(AuthState.IDLE);
          
          toast({
            title: t('connectionError'),
            description: t('authenticationFailed') + '. ' + t('tryAgain'),
            variant: "destructive",
          });
        }
      }
      return success;
    } catch (error) {
      console.error('🔐 Auth: Error updating user info:', error);
      
      // Verificar si fue por desautenticación
      if (!sessionService.isAuthenticated()) {
        console.log('🔐 Auth: User was logged out during update error');
        setUserInfo(null);
        setAuthState(AuthState.IDLE);
        
        toast({
          title: t('connectionError'),
          description: t('authenticationFailed') + '. ' + t('tryAgain'),
          variant: "destructive",
        });
      }
      
      return false;
    }
  }, [toast, t]);

  // Inicialización simplificada
  useEffect(() => {
    console.log('🔐 Auth: Initializing authentication state...');
    refreshUserInfo();
  }, []);

  const contextValue: AuthContextType = {
    // Estado centralizado - solo AuthState como fuente de verdad
    authState,
    userInfo,
    error,
    
    // Servicios
    sessionService,
    
    // Acciones
    login,
    logout,
    updateUserInfo,
    refreshUserInfo,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a AuthProvider');
  }
  return context;
};
