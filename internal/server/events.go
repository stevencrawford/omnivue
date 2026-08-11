package server

import "sync"

// sseEvent is a single server-sent event published to subscribed clients.
type sseEvent struct {
	Name string `json:"name"`
	Data string `json:"data,omitempty"`
}

// EventBus coordinates the SSE subscriber set and fan-out of events to
// connected frontend clients. It is safe for concurrent use.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[chan sseEvent]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{subscribers: make(map[chan sseEvent]struct{})}
}

// Subscribe registers a new SSE subscriber channel. The returned channel must
// be passed to Unsubscribe when the consumer is done.
func (b *EventBus) Subscribe() chan sseEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	ch := make(chan sseEvent, 64)
	b.subscribers[ch] = struct{}{}
	return ch
}

// Unsubscribe removes a previously-subscribed channel.
func (b *EventBus) Unsubscribe(ch chan sseEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.subscribers, ch)
}

// Send delivers an event to every subscriber, dropping it for any subscriber
// whose buffer is full so one slow client cannot block the bus.
func (b *EventBus) Send(event sseEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// CloseAll closes and removes every subscriber channel.
func (b *EventBus) CloseAll() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subscribers {
		close(ch)
		delete(b.subscribers, ch)
	}
}
