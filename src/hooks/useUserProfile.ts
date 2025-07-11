import { useState, useCallback, useRef, useEffect } from 'react';
import { DataState, UserProfile } from '@/types/userData';
import { useAuth } from '@/hooks/useAuth';
import { AuthState } from '@/types/auth';
import { useToast } from '@/hooks/use-toast';
import UserDataService from '@/services/UserDataService';
import { USER_PROFILE_EVENTS } from '@/constants/events';

interface UseUserProfileReturn {
  profile: UserProfile | null;
  state: DataState;
  refetch: () => Promise<void>;
  update: (profile: UserProfile) => Promise<void>;
}

export const useUserProfile = (): UseUserProfileReturn => {
  const { toast } = useToast();
  const { authState, sessionService } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [state, setState] = useState<DataState>(DataState.IDLE);
  const serviceRef = useRef(UserDataService.getInstance());
  const isInitialized = useRef(false);

  // Configurar el servicio UNA SOLA VEZ cuando esté disponible
  useEffect(() => {
    if (sessionService && !isInitialized.current) {
      serviceRef.current.setDropboxService(sessionService);
      isInitialized.current = true;
    }
  }, [sessionService]);

  // Suscribirse a eventos del servicio usando constantes
  useEffect(() => {
    const service = serviceRef.current;
    
    const handleProfileUpdated = (updatedProfile: UserProfile) => {
      console.log('📊 useUserProfile: Profile updated via event', updatedProfile);
      setProfile(updatedProfile);
      setState(DataState.READY);
    };
    
    const handleSyncStart = () => {
      console.log('📊 useUserProfile: Sync started');
      setState(DataState.PROCESSING);
    };
    
    const handleSyncEnd = () => {
      console.log('📊 useUserProfile: Sync ended');
      setState(DataState.READY);
    };
    
    const handleError = (error: any) => {
      console.log('📊 useUserProfile: Error received', error);
      setState(DataState.ERROR);
    };

    // Suscribirse a eventos usando constantes
    service.addEventListener(USER_PROFILE_EVENTS.UPDATED, handleProfileUpdated);
    service.addEventListener(USER_PROFILE_EVENTS.SYNC_START, handleSyncStart);
    service.addEventListener(USER_PROFILE_EVENTS.SYNC_END, handleSyncEnd);
    service.addEventListener(USER_PROFILE_EVENTS.ERROR, handleError);

    return () => {
      // Desuscribirse al desmontar
      service.removeEventListener(USER_PROFILE_EVENTS.UPDATED, handleProfileUpdated);
      service.removeEventListener(USER_PROFILE_EVENTS.SYNC_START, handleSyncStart);
      service.removeEventListener(USER_PROFILE_EVENTS.SYNC_END, handleSyncEnd);
      service.removeEventListener(USER_PROFILE_EVENTS.ERROR, handleError);
    };
  }, []);

  // Función para cargar perfil
  const loadProfile = useCallback(async () => {
    if (authState !== AuthState.AUTHENTICATED) {
      setState(DataState.IDLE);
      setProfile(null);
      return;
    }

    setState(DataState.LOADING);
    
    try {
      const result = await serviceRef.current.getUserProfile();
      setProfile(result.data);
      setState(result.state);
    } catch (error) {
      console.error('📊 useUserProfile: Error loading user profile:', error);
      setProfile(null);
      setState(DataState.ERROR);
    }
  }, [authState]);

  // Función para actualizar perfil (optimista)
  const updateProfile = useCallback(async (newProfile: UserProfile) => {
    if (authState !== AuthState.AUTHENTICATED) return;

    setState(DataState.PROCESSING);
    
    try {
      const result = await serviceRef.current.updateUserProfile(
        newProfile, 
        (updatedProfile) => {
          // Este callback se ejecuta inmediatamente para update optimista
          setProfile(updatedProfile);
          setState(DataState.READY);
        }
      );
      
      if (!result.success) {
        toast({
          title: "Error",
          description: "No se pudo guardar la información",
          variant: "destructive",
        });
      }
      
      setState(result.state);
    } catch (error) {
      console.error('📊 useUserProfile: Error updating user profile:', error);
      setState(DataState.ERROR);
    }
  }, [authState, toast]);

  // Efecto principal para manejo de autenticación
  useEffect(() => {
    if (authState === AuthState.IDLE) {
      setProfile(null);
      setState(DataState.IDLE);
      serviceRef.current.clearUserCache();
    } else if (authState === AuthState.AUTHENTICATED) {
      loadProfile();
    }
  }, [authState, loadProfile]);

  return {
    profile,
    state,
    refetch: loadProfile,
    update: updateProfile
  };
};
