import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

// Starlight 0.34 (Astro 5) 用 docsLoader() + docsSchema() 注册 docs 集合。
// docsSchema() 是关键 — 没有它, getCollection('docs') 在 build 时返回空。
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
}
