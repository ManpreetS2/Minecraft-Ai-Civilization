export function confirmTransfer(args: {
  item: string;
  count: number;
  giverBefore: number;
  giverAfter: number;
  receiverBefore: number;
  receiverAfter: number;
}): boolean {
  const given = args.giverBefore - args.giverAfter;
  const received = args.receiverAfter - args.receiverBefore;
  return given >= args.count && received >= args.count && given > 0 && received > 0;
}
