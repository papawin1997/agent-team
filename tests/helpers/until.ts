/** poll จนกว่า get() คืนค่าไม่ใช่ undefined (ใช้รอไฟล์ที่อีกฝั่งเขียน) */
export async function until<T>(get: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error('until: timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
