import React from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';

interface FileUploaderProps {
  label: string;
  accept: string;
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  helperText?: string;
  color?: 'blue' | 'red' | 'gray';
  disabled?: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ 
  label, 
  accept, 
  onFileSelect, 
  selectedFile, 
  helperText,
  color = 'gray',
  disabled = false
}) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  const borderColor = selectedFile 
    ? 'border-green-500 bg-green-50' 
    : disabled 
      ? 'border-gray-200 bg-gray-100' 
      : `border-${color}-300 hover:bg-${color}-50`;

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div 
        className={`
          relative border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition-all
          ${borderColor}
        `}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        
        {selectedFile ? (
          <div className="flex flex-col items-center text-green-700">
            <CheckCircle className="w-8 h-8 mb-2" />
            <p className="font-medium text-sm truncate max-w-xs">{selectedFile.name}</p>
            <p className="text-xs mt-1">Arquivo carregado</p>
          </div>
        ) : (
          <div className={`flex flex-col items-center ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>
            <Upload className="w-8 h-8 mb-2" />
            <p className="font-medium text-sm">Clique para selecionar</p>
            <p className="text-xs mt-1 text-gray-400">{accept === '.xlsx,.xls' ? 'Excel (.xlsx)' : 'PDF'}</p>
          </div>
        )}
      </div>
      {helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}
    </div>
  );
};

export default FileUploader;