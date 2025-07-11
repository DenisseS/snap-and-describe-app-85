
import { useAuth as useAuthContext } from '../contexts/AuthContext';

export const useDropboxAuth = () => {
  return useAuthContext();
};
