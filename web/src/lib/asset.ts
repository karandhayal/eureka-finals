// Files in /public, resolved against wherever the app is hosted (for example ecell.in/eureka-finals/).
export const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
