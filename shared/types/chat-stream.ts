export interface ChatStreamCitation {
  citationId: string
  sourceChunkId: string
}

export interface ChatStreamReadyEvent {
  event: 'ready'
  data: {
    conversationCreated: boolean
    conversationId: string
  }
}

export interface ChatStreamDeltaEvent {
  event: 'delta'
  data: {
    content: string
  }
}

export interface ChatStreamCompleteEvent {
  event: 'complete'
  data: {
    answer: string
    citations: ChatStreamCitation[]
    conversationCreated: boolean
    conversationId: string
    refused: false
  }
}

export interface ChatStreamRefusalEvent {
  event: 'refusal'
  data: {
    answer: null
    citations: []
    conversationCreated: boolean
    conversationId: string
    refused: true
  }
}

export interface ChatStreamErrorEvent {
  event: 'error'
  data: {
    message: string
  }
}

export type ChatStreamEvent =
  | ChatStreamReadyEvent
  | ChatStreamDeltaEvent
  | ChatStreamCompleteEvent
  | ChatStreamRefusalEvent
  | ChatStreamErrorEvent

export type ChatStreamTerminalEvent = ChatStreamCompleteEvent | ChatStreamRefusalEvent
