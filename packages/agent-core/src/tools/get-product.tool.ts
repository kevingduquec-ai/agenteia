import { resolveProduct, type ProductDetail } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';

export const GET_PRODUCT_TOOL_NAME = 'get_product';

export const getProductToolDefinition: ToolDefinition = {
  name: GET_PRODUCT_TOOL_NAME,
  description: 'Trae el detalle completo (precio, marca, categoria, atributos) de un producto especifico por su nombre.',
  parameters: {
    type: 'object',
    properties: {
      productName: { type: 'string', description: 'Nombre o descripcion del producto que el usuario menciona.' },
    },
    required: ['productName'],
  },
};

export interface GetProductArgs {
  productName: string;
}

export interface GetProductResult {
  found: boolean;
  product?: ProductDetail;
}

export const getProductHandler: ToolHandler<GetProductArgs, GetProductResult> = async (args) => {
  const product = await resolveProduct(args.productName);
  return product ? { found: true, product } : { found: false };
};
