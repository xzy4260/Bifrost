// Provider-reported model sizes, kept beside the live model-name cache.
//
// The datasheet carries curated capability data; this store carries what the
// provider itself answered on its last list-models call. The catalog UI shows
// these as the "original" values an override is compared against, so they are
// refreshed every time the list is fetched and never persisted.
package modelcatalog

import (
	"strings"
	"sync"

	"github.com/maximhq/bifrost/core/schemas"
)

// LiveModelMetadata is what one list-models response reported about a model.
// Both fields are nil when the provider said nothing about them, which the UI
// reads as "no original value to restore".
type LiveModelMetadata struct {
	ContextLength   *int
	MaxOutputTokens *int
}

// IsZero reports whether the provider reported nothing of interest.
func (m LiveModelMetadata) IsZero() bool {
	return m.ContextLength == nil && m.MaxOutputTokens == nil
}

type liveMeta struct {
	mu      sync.RWMutex
	perProv map[schemas.ModelProvider]map[string]LiveModelMetadata
}

func newLiveMeta() *liveMeta {
	return &liveMeta{perProv: make(map[schemas.ModelProvider]map[string]LiveModelMetadata)}
}

// record overwrites the metadata of every model the response mentions. A model
// the provider omitted keeps its previous values; one it reported without sizes
// has them cleared, so a value that disappeared upstream stops being offered as
// restorable.
func (s *liveMeta) record(provider schemas.ModelProvider, entries map[string]LiveModelMetadata) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := s.perProv[provider]
	if existing == nil {
		existing = make(map[string]LiveModelMetadata, len(entries))
		s.perProv[provider] = existing
	}
	for model, meta := range entries {
		existing[model] = meta
	}
}

func (s *liveMeta) get(provider schemas.ModelProvider, model string) (LiveModelMetadata, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	models, ok := s.perProv[provider]
	if !ok {
		return LiveModelMetadata{}, false
	}
	meta, ok := models[model]
	return meta, ok
}

func (s *liveMeta) clear(provider schemas.ModelProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.perProv, provider)
}

func (s *liveMeta) has(provider schemas.ModelProvider) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.perProv[provider]) > 0
}

// recordLiveMetadata stores the sizes a list-models response reported. Entries
// whose ID belongs to another provider are skipped, mirroring extractModelIDs.
func (mc *ModelCatalog) recordLiveMetadata(provider schemas.ModelProvider, resp *schemas.BifrostListModelsResponse) {
	if mc.liveMeta == nil || resp == nil || len(resp.Data) == 0 {
		return
	}
	entries := make(map[string]LiveModelMetadata, len(resp.Data))
	reported := make(map[string]struct{}, len(resp.Data))
	for _, m := range resp.Data {
		parsedProvider, parsedModel := schemas.ParseModelString(m.ID, "")
		if parsedProvider != "" && parsedProvider != provider {
			continue
		}
		name := strings.TrimSpace(parsedModel)
		if name == "" {
			continue
		}
		reported[name] = struct{}{}
		meta := LiveModelMetadata{ContextLength: m.ContextLength, MaxOutputTokens: m.MaxOutputTokens}
		// A later response for the same model wins the fields it actually
		// carries, so a second key that omits them cannot erase the first's.
		if prev, ok := entries[name]; ok {
			if meta.ContextLength == nil {
				meta.ContextLength = prev.ContextLength
			}
			if meta.MaxOutputTokens == nil {
				meta.MaxOutputTokens = prev.MaxOutputTokens
			}
		}
		entries[name] = meta
	}
	if len(entries) == 0 {
		return
	}
	mc.liveMeta.record(provider, entries)
}

// LiveModelMetadataFor returns what the provider last reported for one model.
// The bool is false when the provider has never reported this model.
func (mc *ModelCatalog) LiveModelMetadataFor(provider schemas.ModelProvider, model string) (LiveModelMetadata, bool) {
	if mc.liveMeta == nil {
		return LiveModelMetadata{}, false
	}
	return mc.liveMeta.get(provider, model)
}

// InvalidateLiveMetadata drops everything recorded for the provider.
func (mc *ModelCatalog) InvalidateLiveMetadata(provider schemas.ModelProvider) {
	if mc.liveMeta == nil {
		return
	}
	mc.liveMeta.clear(provider)
}
