import type { OkColorCompileOptions, OkColorTargetConfig, RecipeName } from './types.js'
import { isRecipeName, RECIPE_NAMES } from './types.js'

export type TokenRecipeTargetConfig = OkColorTargetConfig & {
  intent?: RecipeName
  recipe?: RecipeName
  lightness?: number
}

export interface TokenRecipePolicyInput {
  tokenName: string
  tokenRecipe?: string
  targetConfig: OkColorTargetConfig
  recipes?: OkColorCompileOptions['recipes']
}

export interface TokenRecipePolicy {
  config: TokenRecipeTargetConfig
  recipe?: RecipeName
  gradeRecipe: RecipeName
}

export function resolveTokenRecipePolicy(input: TokenRecipePolicyInput): TokenRecipePolicy {
  const recipeConfig = resolveTokenRecipeConfig(input.tokenName, input.tokenRecipe, input.recipes)
  const config = { ...input.targetConfig, ...recipeConfig }
  const recipe = resolveConfiguredRecipe(config.recipe ?? config.intent, input.tokenName)

  return {
    config,
    recipe,
    gradeRecipe: recipe ?? 'premium',
  }
}

function resolveTokenRecipeConfig(
  tokenName: string,
  tokenRecipe: string | undefined,
  recipes: OkColorCompileOptions['recipes'],
): Partial<TokenRecipeTargetConfig> | undefined {
  if (!tokenRecipe) return undefined

  const configured = recipes?.[tokenRecipe]
  if (configured) return configured

  if (!isRecipeName(tokenRecipe)) {
    throw new Error(
      `Unknown okcolor recipe "${tokenRecipe}" for token "${tokenName}". Define options.recipes["${tokenRecipe}"] or use: ${RECIPE_NAMES.join(', ')}`,
    )
  }

  if (tokenRecipe === 'literal') return { strategy: 'convert', recipe: tokenRecipe }
  return { strategy: 'grade', recipe: tokenRecipe }
}

function resolveConfiguredRecipe(value: unknown, tokenName: string): RecipeName | undefined {
  if (value == null) return undefined
  if (isRecipeName(value)) return value
  throw new Error(`Unsupported okcolor recipe "${String(value)}" for token "${tokenName}". Use: ${RECIPE_NAMES.join(', ')}`)
}
