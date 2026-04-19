import * as vscode from 'vscode';
import type { BackendType } from '../types/workspace';

export interface TemplateManifest {
  name: string;
  description: string;
  backendType: BackendType;
  variables: string[];
  files: string[];
}

export class ScaffoldService {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async listTemplates(): Promise<Array<{ name: string; manifest: TemplateManifest }>> {
    const templatesUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'templates');
    const entries = await vscode.workspace.fs.readDirectory(templatesUri);
    const templates: Array<{ name: string; manifest: TemplateManifest }> = [];
    for (const [dirName, fileType] of entries) {
      if (fileType !== vscode.FileType.Directory) { continue; }
      const manifestUri = vscode.Uri.joinPath(templatesUri, dirName, 'template.json');
      try {
        const raw = await vscode.workspace.fs.readFile(manifestUri);
        const manifest: TemplateManifest = JSON.parse(Buffer.from(raw).toString('utf-8'));
        templates.push({ name: dirName, manifest });
      } catch {
        console.warn(`ScaffoldService: skipping template "${dirName}" — no valid template.json`);
      }
    }
    return templates;
  }

  substitute(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
  }

  async scaffold(
    templateName: string,
    manifest: TemplateManifest,
    targetDir: string,
    vars: Record<string, string>,
  ): Promise<string[]> {
    const allVars = { ...vars, CREATED_DATE: new Date().toISOString() };
    const createdFiles: string[] = [];
    const templateDirUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'templates', templateName);
    const targetDirUri = vscode.Uri.file(targetDir);

    for (const relPath of manifest.files) {
      const srcUri = vscode.Uri.joinPath(templateDirUri, relPath);
      const destUri = vscode.Uri.joinPath(targetDirUri, relPath);

      // Create parent directories
      const parentUri = vscode.Uri.joinPath(destUri, '..');
      await vscode.workspace.fs.createDirectory(parentUri);

      const raw = await vscode.workspace.fs.readFile(srcUri);
      const content = Buffer.from(raw).toString('utf-8');
      const substituted = this.substitute(content, allVars);
      await vscode.workspace.fs.writeFile(destUri, Buffer.from(substituted, 'utf-8'));
      createdFiles.push(destUri.fsPath);
    }

    return createdFiles;
  }
}
