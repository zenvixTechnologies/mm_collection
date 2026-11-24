import "server-only";
import type { z } from "zod";
import { connectToDatabase } from "@/server/db/connect";
import { badRequest, notFound } from "@/server/http/errors";
import { User } from "@/server/models/user.model";
import type { addressBody } from "@/server/validation/customer-auth";
import { toStoreUser } from "./customer-auth.service";

export const MAX_ADDRESSES = 10;

type AddressInput = z.output<typeof addressBody>;

const toDoc = (a: AddressInput) => ({
  label: a.label || "Home",
  fullName: a.fullName,
  mobile: a.mobile,
  address: { house: a.house, street: a.street, city: a.city, district: a.district, state: a.state, pincode: a.pincode, country: "India" },
});

/**
 * Saved delivery addresses. Every operation loads the address through the signed-in user's own
 * document, so one customer can never read or change another customer's address.
 */
async function loadUser(userId: string) {
  await connectToDatabase();
  const user = await User.findById(userId);
  if (!user) throw notFound("Account not found.");
  return user;
}

const result = (user: Awaited<ReturnType<typeof loadUser>>) => toStoreUser(user.toObject() as never).addresses;

export async function listAddresses(userId: string) {
  return result(await loadUser(userId));
}

export async function addAddress(userId: string, input: AddressInput) {
  const user = await loadUser(userId);
  if (user.addresses.length >= MAX_ADDRESSES) throw badRequest(`You can save up to ${MAX_ADDRESSES} addresses. Remove one first.`);
  const duplicate = user.addresses.find(
    (a) => a.address.house.toLowerCase() === input.house.toLowerCase() && a.address.pincode === input.pincode && a.address.street.toLowerCase() === input.street.toLowerCase(),
  );
  if (duplicate) {
    if (input.isDefault) user.addresses.forEach((a) => (a.isDefault = a._id.equals(duplicate._id)));
    await user.save();
    return result(user);
  }
  const makeDefault = input.isDefault || user.addresses.length === 0;
  if (makeDefault) user.addresses.forEach((a) => (a.isDefault = false));
  user.addresses.push({ ...toDoc(input), isDefault: makeDefault });
  await user.save();
  return result(user);
}

export async function updateAddress(userId: string, addressId: string, input: AddressInput) {
  const user = await loadUser(userId);
  const target = user.addresses.id(addressId);
  if (!target) throw notFound("Address not found.");
  target.set(toDoc(input));
  if (input.isDefault) user.addresses.forEach((a) => (a.isDefault = a._id.equals(target._id)));
  await user.save();
  return result(user);
}

export async function deleteAddress(userId: string, addressId: string) {
  const user = await loadUser(userId);
  const target = user.addresses.id(addressId);
  if (!target) throw notFound("Address not found.");
  const wasDefault = target.isDefault;
  target.deleteOne();
  if (wasDefault && user.addresses[0]) user.addresses[0].isDefault = true;
  await user.save();
  return result(user);
}

export async function setDefaultAddress(userId: string, addressId: string) {
  const user = await loadUser(userId);
  const target = user.addresses.id(addressId);
  if (!target) throw notFound("Address not found.");
  user.addresses.forEach((a) => (a.isDefault = a._id.equals(target._id)));
  await user.save();
  return result(user);
}
