export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? ""

type Json = Record<string, unknown>

function getAccessToken() {
  try {
    const t = localStorage.getItem("access_token")
    return t && t.length > 0 ? t : null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

function parseErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown; message?: unknown } | unknown
      if (first && typeof first === "object") {
        const msg = (first as { msg?: unknown }).msg
        if (typeof msg === "string" && msg.trim()) return msg
        const message = (first as { message?: unknown }).message
        if (typeof message === "string" && message.trim()) return message
      }
      // Fall back to a compact JSON string for debuggability.
      try {
        return JSON.stringify(detail[0])
      } catch {
        // ignore
      }
    }
    const err = (data as { error?: unknown }).error
    if (typeof err === "string") return err
  }
  return `Request failed (${status})`
}

export async function getJson<TResponse>(
  path: string,
  init?: Omit<RequestInit, "method">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

/** GET list with total from ``X-Total-Count`` response header. */
export async function getJsonList<TItem>(
  path: string,
  init?: Omit<RequestInit, "method">,
): Promise<{ items: TItem[]; total: number }> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  const totalHeader = res.headers.get("X-Total-Count")
  const total = totalHeader != null && totalHeader !== "" ? Number(totalHeader) : Array.isArray(data) ? data.length : 0

  return { items: (Array.isArray(data) ? data : []) as TItem[], total: Number.isFinite(total) ? total : 0 }
}

export async function postJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function postForm<TResponse>(
  path: string,
  form: FormData,
  init?: Omit<RequestInit, "method" | "body" | "headers">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

/** GET binary (e.g. Excel export). */
export async function getBlob(path: string): Promise<Blob> {
  const res = await authFetch(path)
  if (!res.ok) {
    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
  return res.blob()
}

/** Authenticated fetch (e.g. binary negotiation attachments). Caller checks ``res.ok``. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
}

export async function patchJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function putJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function deleteJson<TResponse = void>(
  path: string,
  init?: Omit<RequestInit, "method" | "body">,
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined

  if (!res.ok) {
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}
