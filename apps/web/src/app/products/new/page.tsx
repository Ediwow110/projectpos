import { redirect } from "next/navigation";

export default function NewProductRoute(): never {
  redirect("/products?create=1");
}
