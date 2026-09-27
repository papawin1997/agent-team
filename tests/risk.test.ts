import { describe, expect, it } from 'vitest';
import { riskFlags, riskText } from '../src/risk';
import { makeRequirements } from './helpers/builders';

describe('riskFlags', () => {
  it('งานทั่วไปไม่มีหมวดเสี่ยง', () => {
    expect(riskFlags('แก้คำผิดในหน้า about และเปลี่ยนสีปุ่ม')).toEqual([]);
    expect(riskFlags('เพิ่ม/ลบ todo ในรายการ')).toEqual([]);
    expect(riskFlags('เพิ่มหน้า authors และรองรับ mysql กับ postgresql')).toEqual([]);
  });

  it('ภาษาอังกฤษ: ไม่สนตัวพิมพ์ และดูเป็นคำ ไม่ใช่ส่วนของคำอื่น', () => {
    expect(riskFlags('Add Google LOGIN button')).toEqual(['auth']);
    expect(riskFlags('store the API key in .env')).toEqual(['secret']);
    expect(riskFlags('Stripe checkout for payment')).toEqual(['payment']);
    expect(riskFlags('DROP TABLE users')).toEqual(['delete']);
    expect(riskFlags('write a migration to alter table')).toEqual(['migration']);
    expect(riskFlags('build the report with raw SQL')).toEqual(['sql']);
    expect(riskFlags('allow file upload')).toEqual(['upload']);
    expect(riskFlags('run it with child_process exec')).toEqual(['shell']);
    expect(riskFlags('enable CORS for the webhook')).toEqual(['network']);
  });

  it('ภาษาไทย', () => {
    expect(riskFlags('เพิ่มหน้าเข้าสู่ระบบด้วยรหัสผ่าน')).toEqual(['auth']);
    expect(riskFlags('เก็บคีย์ลับไว้ในไฟล์')).toEqual(['secret']);
    expect(riskFlags('ให้ลูกค้าชำระเงินด้วยบัตรเครดิต')).toEqual(['payment']);
    expect(riskFlags('ปุ่มลบข้อมูลทั้งหมดของผู้ใช้')).toEqual(['delete']);
    expect(riskFlags('ย้ายข้อมูลไปฐานข้อมูลใหม่')).toEqual(['migration']);
    expect(riskFlags('ให้อัปโหลดรูปโปรไฟล์ได้')).toEqual(['upload']);
    expect(riskFlags('ให้ระบบรันคำสั่งบนเซิร์ฟเวอร์')).toEqual(['shell']);
  });

  it('หลายหมวดพร้อมกัน: ไม่ซ้ำและเรียงตามลำดับหมวด', () => {
    expect(riskFlags('upload avatar after login, login again, then pay via payment page')).toEqual([
      'auth',
      'payment',
      'upload',
    ]);
  });
});

describe('riskText', () => {
  it('รวม goal/features/constraints/acceptanceCriteria และ quickTask แต่ไม่รวม outOfScope', () => {
    const req = { ...makeRequirements(), outOfScope: ['ระบบ login'] };
    const text = riskText(req, { title: 'แก้ปุ่ม', description: 'เปลี่ยนสีปุ่ม', acceptanceCriteria: ['ปุ่มเป็นสีเขียว'] });
    expect(text).toContain('todo list');
    expect(text).toContain('เปลี่ยนสีปุ่ม');
    expect(text).toContain('ปุ่มเป็นสีเขียว');
    expect(text).not.toContain('login');
    expect(riskFlags(text)).toEqual([]);
  });
});
