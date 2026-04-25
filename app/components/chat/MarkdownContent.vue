<script setup lang="ts">
  import { refDebounced } from '@vueuse/core'

  interface Props {
    content: string
    streaming?: boolean
  }

  const props = withDefaults(defineProps<Props>(), {
    streaming: false,
  })

  const liveContent = toRef(props, 'content')
  const debouncedContent = refDebounced(liveContent, 30)
  const renderedContent = computed(() => (props.streaming ? debouncedContent.value : props.content))
</script>

<template>
  <div class="chat-markdown text-sm leading-relaxed text-default">
    <MDC :value="renderedContent" tag="div" />
    <span
      v-if="streaming"
      class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-inverted align-text-bottom motion-reduce:animate-none"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
  .chat-markdown :deep(> div > *:first-child) {
    margin-top: 0;
  }

  .chat-markdown :deep(> div > *:last-child) {
    margin-bottom: 0;
  }

  .chat-markdown :deep(p) {
    margin: 0.5rem 0;
    word-break: break-word;
  }

  .chat-markdown :deep(h1),
  .chat-markdown :deep(h2),
  .chat-markdown :deep(h3),
  .chat-markdown :deep(h4),
  .chat-markdown :deep(h5),
  .chat-markdown :deep(h6) {
    margin: 0.75rem 0 0.5rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .chat-markdown :deep(h1) {
    font-size: 1.25rem;
  }
  .chat-markdown :deep(h2) {
    font-size: 1.125rem;
  }
  .chat-markdown :deep(h3) {
    font-size: 1rem;
  }
  .chat-markdown :deep(h4),
  .chat-markdown :deep(h5),
  .chat-markdown :deep(h6) {
    font-size: 0.95rem;
  }

  .chat-markdown :deep(ul),
  .chat-markdown :deep(ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .chat-markdown :deep(ul) {
    list-style: disc;
  }

  .chat-markdown :deep(ol) {
    list-style: decimal;
  }

  .chat-markdown :deep(li) {
    margin: 0.125rem 0;
  }

  .chat-markdown :deep(li > ul),
  .chat-markdown :deep(li > ol) {
    margin: 0.125rem 0;
  }

  .chat-markdown :deep(strong) {
    font-weight: 600;
  }

  .chat-markdown :deep(em) {
    font-style: italic;
  }

  .chat-markdown :deep(a) {
    color: var(--ui-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .chat-markdown :deep(a:hover) {
    text-decoration-thickness: 2px;
  }

  .chat-markdown :deep(code) {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background-color: var(--ui-bg-elevated);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.875em;
  }

  .chat-markdown :deep(pre) {
    margin: 0.5rem 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background-color: var(--ui-bg-elevated);
    overflow-x: auto;
  }

  .chat-markdown :deep(pre code) {
    padding: 0;
    background-color: transparent;
    font-size: 0.875em;
    line-height: 1.5;
  }

  .chat-markdown :deep(blockquote) {
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    border-left: 3px solid var(--ui-border);
    color: var(--ui-text-muted);
  }

  .chat-markdown :deep(hr) {
    margin: 0.75rem 0;
    border: 0;
    border-top: 1px solid var(--ui-border);
  }

  .chat-markdown :deep(table) {
    margin: 0.5rem 0;
    border-collapse: collapse;
    font-size: 0.875em;
  }

  .chat-markdown :deep(th),
  .chat-markdown :deep(td) {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--ui-border);
    text-align: left;
  }

  .chat-markdown :deep(th) {
    background-color: var(--ui-bg-elevated);
    font-weight: 600;
  }

  .chat-markdown :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
  }
</style>
