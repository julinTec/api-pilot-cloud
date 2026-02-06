-- Grant execute permission on the RPC function to anonymous users
GRANT EXECUTE ON FUNCTION public.get_file_data(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_file_data(TEXT) TO authenticated;