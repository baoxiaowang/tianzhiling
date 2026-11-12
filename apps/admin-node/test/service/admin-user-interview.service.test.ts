import { readFileSync } from 'fs';
import { join } from 'path';
import { AdminUserInterviewService } from '../../src/service/admin-user-interview.service';

const FIXTURE = join(__dirname, '../fixtures/interview-sample.docx');
const PDF_FIXTURE = join(__dirname, '../fixtures/interview-sample.pdf');

describe('AdminUserInterviewService', () => {
  const createService = () => {
    const service = new AdminUserInterviewService();
    (service as any).logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    (service as any).adminLlmService = { currentModel: () => 'test-model' };
    return service;
  };

  it('大纲包含 25 道题且分组覆盖全部题号', () => {
    const service = createService();
    const prompt = service.buildStructurePrompt('测试逐字稿');
    for (let no = 1; no <= 25; no += 1) {
      expect(prompt).toContain(`${no}. `);
    }
    expect(prompt).toContain('只输出 JSON');
    expect(prompt).toContain('答案');
  });

  it('过长逐字稿会被截断并标注', () => {
    const service = createService();
    const prompt = service.buildStructurePrompt('x'.repeat(150000));
    expect(prompt).toContain('逐字稿过长，已截断');
    expect(prompt.length).toBeLessThan(150000);
  });

  it('docx 可提取出纯文本', async () => {
    const service = createService();
    const base64 = readFileSync(FIXTURE).toString('base64');
    const result = await service.extractDocx({
      fileName: 'interview-sample.docx',
      base64,
    });
    expect(result.fileName).toBe('interview-sample.docx');
    expect(result.text).toContain('访谈逐字稿');
    expect(result.text).toContain('我今年 32 岁');
    expect(result.text).toContain('小使者');
  });

  it('PDF 可提取出纯文本', async () => {
    const service = createService();
    const base64 = readFileSync(PDF_FIXTURE).toString('base64');
    const result = await service.extractPdf({
      fileName: 'interview-sample.pdf',
      base64,
    });
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.text).toContain('Interview transcript sample');
    expect(result.text).toContain('three months');
  });

  it('非 PDF 内容会报格式错误', async () => {
    const service = createService();
    await expect(
      service.extractPdf({ base64: Buffer.from('not-a-pdf').toString('base64') })
    ).rejects.toMatchObject({ code: 'INTERVIEW_PDF_INVALID' });
  });

  it('非 docx 内容会报格式错误', async () => {
    const service = createService();
    await expect(
      service.extractDocx({ base64: Buffer.from('not-a-zip').toString('base64') })
    ).rejects.toMatchObject({ code: 'INTERVIEW_DOCX_INVALID' });
  });
});
