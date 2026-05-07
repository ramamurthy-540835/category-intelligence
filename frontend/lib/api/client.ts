export const apiClient = {
  async get(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
  async post(url: string, data: any) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('API Error');
    return res.json();
  }
};

