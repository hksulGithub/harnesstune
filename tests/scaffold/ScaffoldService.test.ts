import { ScaffoldService } from '../../src/scaffold/ScaffoldService';

describe('ScaffoldService', () => {
  let service: ScaffoldService;

  beforeEach(() => {
    // extensionUri is only used by listTemplates/scaffold which depend on vscode.workspace.fs
    // For unit tests of pure functions, we pass a dummy URI
    service = new ScaffoldService(null as any);
  });

  describe('substitute', () => {
    it('replaces {{AGENT_NAME}} and {{AGENT_ROLE}} tokens with provided values', () => {
      const content = '# {{AGENT_NAME}}\n\n**Role:** {{AGENT_ROLE}}';
      const result = service.substitute(content, {
        AGENT_NAME: 'TestBot',
        AGENT_ROLE: 'Code Reviewer',
      });
      expect(result).toBe('# TestBot\n\n**Role:** Code Reviewer');
    });

    it('leaves unknown {{UNKNOWN_TOKEN}} tokens unchanged (not stripped)', () => {
      const content = 'Hello {{KNOWN}} and {{UNKNOWN_TOKEN}}';
      const result = service.substitute(content, {
        KNOWN: 'World',
      });
      expect(result).toBe('Hello World and {{UNKNOWN_TOKEN}}');
    });

    it('replaces multiple occurrences of the same token', () => {
      const content = '{{NAME}} is {{NAME}}';
      const result = service.substitute(content, { NAME: 'Alice' });
      expect(result).toBe('Alice is Alice');
    });

    it('handles empty vars object', () => {
      const content = '{{A}} {{B}}';
      const result = service.substitute(content, {});
      expect(result).toBe('{{A}} {{B}}');
    });
  });
});
