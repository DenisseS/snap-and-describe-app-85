
import { DropboxAPI } from './DropboxAPI';

export class DropboxFileManagerService {
  constructor(private api: DropboxAPI) {}

  // Método genérico para obtener cualquier archivo
  async getFile(accessToken: string, filePath: string): Promise<any | null> {
    try {
      const response = await this.api.downloadFile(accessToken, filePath);

      if (response.status === 409) {
        // File doesn't exist
        return null;
      }

      if (!response.ok) {
        throw new Error(`Failed to read file: ${filePath}`);
      }

      const jsonContent = await response.text();
      return JSON.parse(jsonContent);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  // Método genérico para actualizar cualquier archivo
  // Confía en que los datos locales están correctos, no descarga primero
  async updateFile(accessToken: string, filePath: string, data: any): Promise<boolean> {
    try {
      const response = await this.api.uploadFile(
        accessToken,
        filePath,
        JSON.stringify(data, null, 2),
        'overwrite'
      );

      return response.ok;
    } catch (error) {
      console.error(`Error updating file ${filePath}:`, error);
      return false;
    }
  }

  // Obtener metadata del archivo para sync
  async getFileMetadata(accessToken: string, filePath: string): Promise<{ client_modified: string } | null> {
    try {
      const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: filePath }),
      });

      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error(`Error getting metadata for ${filePath}:`, error);
      return null;
    }
  }
}
