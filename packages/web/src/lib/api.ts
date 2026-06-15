const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const errVal = body?.error;
    const message =
      typeof errVal === 'string'
        ? errVal
        : typeof errVal === 'object' && errVal !== null
        ? Object.entries(errVal.fieldErrors ?? {})
            .map(([f, msgs]) => `${f}: ${(msgs as string[]).join(', ')}`)
            .join('; ') || JSON.stringify(errVal)
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  setupStatus: () => request<{ setupRequired: boolean }>('/auth/setup-status'),
  setup: (body: { username: string; displayName: string; password: string }) =>
    request('/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // Users (admin)
  getUsers: () => request('/users'),
  createUser: (body: object) =>
    request('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: number, body: object) =>
    request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteUser: (id: number) => request(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id: number, password: string) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  // Reference data
  getDietaryTypes: () => request('/meals/dietary-types'),
  getCuisines: () => request('/meals/cuisines'),
  getIngredientCategories: () => request('/meals/ingredient-categories'),

  // Ingredients
  getIngredients: (search?: string) =>
    request(`/meals/ingredients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createIngredient: (body: object) =>
    request('/meals/ingredients', { method: 'POST', body: JSON.stringify(body) }),

  // Meals
  getMeals: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/meals${qs}`);
  },
  getMeal: (id: number) => request(`/meals/${id}`),
  createMeal: (body: object) =>
    request('/meals', { method: 'POST', body: JSON.stringify(body) }),
  updateMeal: (id: number, body: object) =>
    request(`/meals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMeal: (id: number) => request(`/meals/${id}`, { method: 'DELETE' }),

  // Planner
  getWeekPlan: (weekStart: string) => request(`/planner?weekStart=${weekStart}`),
  setPlanSlot: (date: string, slot: string, body: object) =>
    request(`/planner/${date}/${slot}`, { method: 'PUT', body: JSON.stringify(body) }),
  clearPlanSlot: (date: string, slot: string) =>
    request(`/planner/${date}/${slot}`, { method: 'DELETE' }),
  getShoppingList: (weekStart: string) =>
    request(`/planner/shopping-list?weekStart=${weekStart}`),

  // Import
  importUrl: (url: string) =>
    request('/import/url', { method: 'POST', body: JSON.stringify({ url }) }),
  importCsv: (csvText: string) =>
    request('/import/csv', { method: 'POST', body: JSON.stringify({ csvText }) }),
  importParseHtml: (html: string, sourceUrl: string) =>
    request('/import/parse-html', { method: 'POST', body: JSON.stringify({ html, sourceUrl }) }),

  // Family
  getFamilyMembers: () => request('/family'),
  createFamilyMember: (body: object) =>
    request('/family', { method: 'POST', body: JSON.stringify(body) }),
  updateFamilyMember: (id: number, body: object) =>
    request(`/family/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFamilyMember: (id: number) => request(`/family/${id}`, { method: 'DELETE' }),

  // Planner rules & settings
  getPlannerRules: () => request('/planner/rules'),
  updatePlannerRule: (id: number, body: object) =>
    request(`/planner/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getPlannerSettings: () => request('/planner/settings'),
  updatePlannerSettings: (body: object) =>
    request('/planner/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  autoGenerateWeek: (body: object) =>
    request('/planner/auto-generate', { method: 'POST', body: JSON.stringify(body) }),
};
