import { NextResponse } from 'next/server';
import { parseBufferRoster } from '../../../services/fileService';

const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1rs1PsUmX5nZy8wSBjthX4oeCOVM1ni3qn2SRICCX4cE/export?format=xlsx&gid=1921093976';

export async function GET() {
  try {
    const response = await fetch(SPREADSHEET_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Google Sheets: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const personnel = parseBufferRoster(arrayBuffer);
    
    return NextResponse.json({ personnel }, { status: 200 });
  } catch (error: any) {
    console.error('API /api/efetivo error:', error);
    return NextResponse.json({ error: error.message || 'Error occurred while syncing' }, { status: 500 });
  }
}
