import { describe, expect, it } from 'vitest';
import { designRiskText, mergeRiskFlags, riskFlags, riskText } from '../src/risk';
import { makeDesign, makeRequirements, makeTask } from './helpers/builders';

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

describe('riskFlags - แก้ false negative/positive จาก review', () => {
  it('auth: false negatives ภาษาอังกฤษที่ต้องจับ', () => {
    expect(riskFlags('Please log in to continue')).toEqual(['auth']);
    expect(riskFlags('Show this page to authenticated users only')).toEqual(['auth']);
    expect(riskFlags('authorize the request before proceeding')).toEqual(['auth']);
    expect(riskFlags('authorized users')).toEqual(['auth']);
    expect(riskFlags('signed-in users')).toEqual(['auth']);
  });

  it('auth: false negatives ภาษาไทยที่ต้องจับ', () => {
    expect(riskFlags('ต้องขอการอนุญาตจากแอดมิน')).toEqual(['auth']);
    expect(riskFlags('กรอกพาสเวิร์ดเพื่อเข้าใช้งาน')).toEqual(['auth']);
    expect(riskFlags('ล็อคอินด้วย Google')).toEqual(['auth']);
  });

  it('auth: session ที่มีบริบทเฉพาะยังต้องจับ (ไม่ใช่ session เดี่ยว ๆ)', () => {
    expect(riskFlags('rotate the session id')).toEqual(['auth']);
    expect(riskFlags('read the session cookie')).toEqual(['auth']);
    expect(riskFlags('protect against session hijacking')).toEqual(['auth']);
    expect(riskFlags('store the login session')).toEqual(['auth']);
  });

  it('sql: ตรวจจับคำสั่ง SQL จาก pattern ไม่ใช่แค่คำว่า sql', () => {
    expect(riskFlags('run SELECT * FROM users WHERE id = 1')).toEqual(['sql']);
    expect(riskFlags('INSERT INTO orders (id, total) VALUES (1, 100)')).toEqual(['sql']);
    expect(riskFlags("UPDATE users SET role = 'admin'")).toEqual(['sql']);
    expect(riskFlags('DELETE FROM sessions')).toEqual(['sql']);
  });

  it('delete: false negatives ภาษาอังกฤษที่ต้องจับ', () => {
    expect(riskFlags('delete everything in the folder')).toEqual(['delete']);
    expect(riskFlags('remove all customer data')).toEqual(['delete']);
  });

  it('delete: false negatives ภาษาไทยที่ต้องจับ (ลบ + ทั้งหมด/ทุก เป็น substring แยกกันได้)', () => {
    expect(riskFlags('ลบผู้ใช้ทั้งหมด')).toEqual(['delete']);
    expect(riskFlags('ลบข้อมูลลูกค้าทั้งหมด')).toEqual(['delete']);
  });

  it('delete: เทสต์เดิมต้องยังผ่าน (มี ลบ แต่ไม่มี ทั้งหมด/ทุก ไม่ควรเข้าเงื่อนไข)', () => {
    expect(riskFlags('เพิ่ม/ลบ todo ในรายการ')).toEqual([]);
  });

  it('delete: ภาษาไทย false positive จาก review — มี "ลบ" + "ทุก"/"ทั้งหมด" แต่ไม่ได้พูดถึงข้อมูล/ผู้ใช้/ลูกค้า ไม่ควรเข้าเงื่อนไข', () => {
    expect(riskFlags('แก้ปุ่มให้ทุกหน้าลบเงาออก')).toEqual([]);
    expect(riskFlags('ลบ console.log ทุกไฟล์')).toEqual([]);
    expect(riskFlags('ลบ todo ได้ทุกรายการ')).toEqual([]);
  });

  it('delete: ต้องยังจับกรณีลบข้อมูล/ผู้ใช้/ลูกค้าทั้งหมดเหมือนเดิม', () => {
    expect(riskFlags('ปุ่มลบข้อมูลทั้งหมดของผู้ใช้')).toEqual(['delete']);
    expect(riskFlags('ลบผู้ใช้ทั้งหมด')).toEqual(['delete']);
    expect(riskFlags('ลบข้อมูลลูกค้าทั้งหมด')).toEqual(['delete']);
  });

  it('delete: round 2 nit — ต้องมี proximity ระหว่าง "ลบ" กับ "ทั้งหมด"/"ทุก" ไม่ใช่แค่ substring ที่ไหนก็ได้ในข้อความ', () => {
    // "ทุก" อยู่ห่างจาก "ลบ" เกินระยะ (คนละบริบท: ลบปุ่ม vs แสดงทุกหน้า) ต้องไม่จับ แม้จะมีคำว่า "ผู้ใช้" อยู่ในข้อความด้วยก็ตาม
    expect(riskFlags('เพิ่มปุ่มลบในหน้าผู้ใช้ ให้แสดงทุกหน้า')).toEqual([]);
    // "ทุก" อยู่ก่อน "ลบ" (ไม่ใช่หลัง) ต้องไม่จับ
    expect(riskFlags('แก้ปุ่มให้ทุกหน้าลบเงาออก')).toEqual([]);
    // "ทุก" อยู่ใกล้ "ลบ" แต่ไม่มีคำที่หมายถึงข้อมูล (DATA_NOUNS_TH) ต้องไม่จับ
    expect(riskFlags('ลบ console.log ทุกไฟล์')).toEqual([]);
    expect(riskFlags('ลบ todo ได้ทุกรายการ')).toEqual([]);
  });

  it('delete: round 2 nit — "ทั้งหมด"/"ทุก" อยู่ใกล้ "ลบ" (หลัง) และมีคำข้อมูลด้วย ต้องยังจับเหมือนเดิม', () => {
    expect(riskFlags('ปุ่มลบข้อมูลทั้งหมดของผู้ใช้')).toEqual(['delete']);
    expect(riskFlags('ลบผู้ใช้ทั้งหมด')).toEqual(['delete']);
    expect(riskFlags('ลบข้อมูลลูกค้าทั้งหมด')).toEqual(['delete']);
    expect(riskFlags('ลบบัญชีทุกบัญชีที่ไม่ได้ใช้')).toEqual(['delete']);
  });

  it('shell: false negatives ที่ต้องจับ', () => {
    expect(riskFlags('use os.system to run a command')).toEqual(['shell']);
    expect(riskFlags('subprocess.run(["ls"])')).toEqual(['shell']);
    expect(riskFlags('Runtime.exec("ls")')).toEqual(['shell']);
  });

  it('false positives ที่ต้องตัดออก: token/session แบบคำเดี่ยวลอย ๆ', () => {
    expect(riskFlags('Add CSS design tokens for spacing and colors')).toEqual([]);
    expect(riskFlags('Schedule a planning session for next sprint')).toEqual([]);
  });

  it('secret: token ที่มีบริบทเฉพาะยังต้องจับ', () => {
    expect(riskFlags('store the access token securely')).toEqual(['secret']);
    expect(riskFlags('refresh token rotation')).toEqual(['secret']);
    expect(riskFlags('use an api token for this call')).toEqual(['secret']);
    expect(riskFlags('bearer token in the header')).toEqual(['secret']);
    expect(riskFlags('generate a personal access token')).toEqual(['secret']);
  });

  it('secret+auth: "auth token" เข้าทั้งสองหมวดเพราะมีคำว่า auth เดี่ยว ๆ อยู่ด้วย', () => {
    expect(riskFlags('send the auth token')).toEqual(['auth', 'secret']);
  });
});

describe('riskFlags - inflections เพิ่มเติมจาก final review', () => {
  it('auth: พหูพจน์/รูปแปลงของ password, login, authenticate, oauth', () => {
    expect(riskFlags('hash user passwords')).toEqual(['auth']);
    expect(riskFlags('show recent logins')).toEqual(['auth']);
    expect(riskFlags('authenticates users')).toEqual(['auth']);
    expect(riskFlags('OAuth2')).toEqual(['auth']);
  });

  it('secret: API keys (พหูพจน์)', () => {
    expect(riskFlags('store API keys')).toEqual(['secret']);
  });

  it('payment: invoices (พหูพจน์)', () => {
    expect(riskFlags('paid invoices')).toEqual(['payment']);
  });

  it('upload: uploaded/uploading', () => {
    expect(riskFlags('uploaded files list')).toEqual(['upload']);
    expect(riskFlags('uploading avatar')).toEqual(['upload']);
  });

  it('migration: migrated', () => {
    expect(riskFlags('migrated data')).toEqual(['migration']);
  });

  it('shell: execute/executes/executed/executing', () => {
    expect(riskFlags('execute a command on server')).toEqual(['shell']);
  });
});

describe('riskFlags - sql: ต้องไม่ข้าม field/บรรทัด', () => {
  it('ไม่จับประโยคภาษาอังกฤษทั่วไปที่บังเอิญมีคำว่า select/from หรือ update/set', () => {
    expect(riskFlags('update the header text and set color')).toEqual([]);
    expect(riskFlags('select a color from the palette')).toEqual([]);
  });

  it('ตัวอย่าง SQL จริงยังถูกจับเหมือนเดิม', () => {
    expect(riskFlags('run SELECT * FROM users WHERE id = 1')).toEqual(['sql']);
    expect(riskFlags("UPDATE users SET role = 'admin'")).toEqual(['sql']);
    expect(riskFlags('DELETE FROM sessions')).toEqual(['sql']);
    expect(riskFlags('build the report with raw SQL')).toEqual(['sql']);
  });

  it('false negative จาก review: gap ยาวเกิน 8 ตัวอักษร (คอลัมน์/ชื่อตารางยาว) ต้องยังจับได้', () => {
    expect(riskFlags('SELECT id, name, email FROM users')).toEqual(['sql']);
    expect(riskFlags('update user_profiles set email = ?')).toEqual(['sql']);
  });

  it('เคสก้ำกึ่ง "select a from b" (คอลัมน์เดี่ยว ไม่มี comma/*): ตัดสินใจไม่จับ เพราะแยกจากประโยคภาษาอังกฤษทั่วไปไม่ได้', () => {
    expect(riskFlags('select a from b')).toEqual([]);
  });
});

describe('riskFlags - sql: round 2 nits', () => {
  it('aggregate function ตามด้วย ( เช่น COUNT(*) ต้องจับ', () => {
    expect(riskFlags('SELECT COUNT(*) FROM orders')).toEqual(['sql']);
    expect(riskFlags('select sum(total) from orders')).toEqual(['sql']);
  });

  it('คอลัมน์เดี่ยว แต่ตามด้วยชื่อตาราง + where/join/order by/group by/limit ต้องจับ', () => {
    expect(riskFlags('select name from users where id = 1')).toEqual(['sql']);
    expect(riskFlags('select id from orders join shipments')).toEqual(['sql']);
    expect(riskFlags('select id from orders order by created_at')).toEqual(['sql']);
    expect(riskFlags('select id from orders group by status')).toEqual(['sql']);
    expect(riskFlags('select id from orders limit 10')).toEqual(['sql']);
  });

  it('UPDATE กับ identifier แบบ double-quote/backtick ต้องจับ', () => {
    expect(riskFlags('UPDATE "users" SET name = 1')).toEqual(['sql']);
    expect(riskFlags('UPDATE `users` SET name = 1')).toEqual(['sql']);
  });

  it('เทสต์เดิมต้องยังไม่จับ (ประโยคทั่วไป ไม่ใช่ SQL จริง)', () => {
    expect(riskFlags('select a color from the palette')).toEqual([]);
    expect(riskFlags('update the header text and set color')).toEqual([]);
  });

  it('เคสก้ำกึ่ง "select the best one from the list and order by price": ตัดสินใจไม่จับ ' +
    'เพราะคอลัมน์เป็นวลีหลายคำ ("the best one") ไม่ใช่ชื่อคอลัมน์คำเดียวติดกับ from ' +
    'เหมือนกับเหตุผลที่ไม่จับ "select a color from the palette" — ถ้าจับ จะ false positive กับประโยคภาษาอังกฤษทั่วไปที่มี order by ปนอยู่ได้ง่าย', () => {
    expect(riskFlags('select the best one from the list and order by price')).toEqual([]);
  });
});

describe('mergeRiskFlags', () => {
  it('รวมหมวดจากหลายแหล่ง ไม่ซ้ำ เรียงตามลำดับหมวดเดิม', () => {
    expect(mergeRiskFlags(['payment'], ['auth'], ['auth', 'payment'])).toEqual(['auth', 'payment']);
    expect(mergeRiskFlags([], [])).toEqual([]);
    expect(mergeRiskFlags(['upload'], ['secret'])).toEqual(['secret', 'upload']);
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

describe('designRiskText', () => {
  it('รวม architecture และข้อความของทุก task', () => {
    const design = makeDesign([makeTask('api'), { ...makeTask('login'), title: 'หน้า login', description: 'เพิ่ม session' }]);
    const text = designRiskText({ ...design, architecture: 'ใช้ Express' });
    expect(text).toContain('ใช้ Express');
    expect(text).toContain('หน้า login');
    expect(riskFlags(text)).toContain('auth');
  });
});
