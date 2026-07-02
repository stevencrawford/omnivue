package claudecode

import "strings"

// simplifyModelName strips the "anthropic/" prefix from model names for display.
func simplifyModelName(model string) string {
	return strings.TrimPrefix(model, "anthropic/")
}

// anthropicPricing maps model names to per-million-token costs.
// Prices are for Claude 4.5 family and older Claude models.
var anthropicPricing = map[string]struct {
	Input, Output, CacheRead, CacheWrite float64
}{
	"claude-4-5-sonnet-20250929":       {3.00, 15.00, 0.30, 3.75},
	"claude-sonnet-4-5-20250929":       {3.00, 15.00, 0.30, 3.75},
	"claude-4-5-opus-20251101":         {15.00, 75.00, 1.50, 18.75},
	"claude-opus-4-5-20251101":         {15.00, 75.00, 1.50, 18.75},
	"claude-4-5-haiku-20251001":        {0.25, 1.25, 0.025, 0.3125},
	"claude-haiku-4-5-20251001":        {0.25, 1.25, 0.025, 0.3125},
	"claude-3-5-sonnet-20241022":       {3.00, 15.00, 0.30, 3.75},
	"claude-3-5-haiku-20241022":        {0.80, 4.00, 0.08, 1.00},
	"claude-3-opus-20240229":           {15.00, 75.00, 1.50, 18.75},
	"claude-3-sonnet-20240229":         {3.00, 15.00, 0.30, 3.75},
	"claude-3-haiku-20240307":          {0.25, 1.25, 0.025, 0.3125},
}

func calculateCost(model string, tokensIn, tokensOut, cacheWrite, cacheRead int) float64 {
	pricing, ok := anthropicPricing[model]
	if !ok {
		return 0
	}
	inputCost := float64(tokensIn) / 1_000_000.0 * pricing.Input
	outputCost := float64(tokensOut) / 1_000_000.0 * pricing.Output
	cacheReadCost := float64(cacheRead) / 1_000_000.0 * pricing.CacheRead
	cacheWriteCost := float64(cacheWrite) / 1_000_000.0 * pricing.CacheWrite
	return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
